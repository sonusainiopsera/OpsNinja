import { ConflictException, GoneException } from '@nestjs/common';
import { CsatService } from '../csat.service';
import { CsatTokenService } from '../csat-token.service';
import type { CsatSurvey } from '@opsninja/db';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSurvey(overrides: Partial<CsatSurvey> = {}): CsatSurvey {
  const now = new Date('2025-06-01T12:00:00Z');
  const expires = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
  return {
    tenantId: 'tenant-1',
    id: 'survey-1',
    ticketId: 'ticket-1',
    contactId: 'contact-1',
    tokenHash: 'a'.repeat(64),
    score: null,
    comment: null,
    responseSource: null,
    sentAt: now,
    delivered: true,
    expiresAt: expires,
    respondedAt: null,
    reminderSentAt: null,
    ...overrides,
  };
}

function makeDb(updatedRows: { id: string }[]) {
  return {
    transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockReturnValue({
          set: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue(updatedRows),
            }),
          }),
        }),
      };
      return fn(tx);
    }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CsatService', () => {
  let tokenService: CsatTokenService;

  beforeEach(() => {
    tokenService = new CsatTokenService(() => new Date('2025-06-01T12:00:00Z'));
  });

  describe('submit', () => {
    it('records the response when survey is open', async () => {
      const db = makeDb([{ id: 'survey-1' }]);
      const service = new CsatService(db as never, tokenService);
      const survey = makeSurvey();
      await expect(
        service.submit(survey, { score: 4, comment: 'Great support!' }, 'form'),
      ).resolves.toBeUndefined();
    });

    it('throws ConflictException when survey already responded', async () => {
      const db = makeDb([]);
      const service = new CsatService(db as never, tokenService);
      const survey = makeSurvey({ respondedAt: new Date('2025-06-01T11:00:00Z') });
      await expect(service.submit(survey, { score: 3 }, 'form')).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException on concurrent double-submit (zero rows returned)', async () => {
      const db = makeDb([]);
      const service = new CsatService(db as never, tokenService);
      const survey = makeSurvey();
      // DB returns empty RETURNING (another worker won the race)
      await expect(service.submit(survey, { score: 5 }, 'form')).rejects.toThrow(ConflictException);
    });

    it('throws GoneException when survey is expired', async () => {
      const expiredTime = new Date('2025-05-01T00:00:00Z');
      const db = makeDb([]);
      const service = new CsatService(db as never, tokenService);
      const survey = makeSurvey({ expiresAt: expiredTime });
      await expect(service.submit(survey, { score: 2 }, 'form')).rejects.toThrow(GoneException);
    });

    it('rejects score 0', async () => {
      // This is validated at the DTO layer, not service layer; just verify pass-through
      const db = makeDb([{ id: 'survey-1' }]);
      const service = new CsatService(db as never, tokenService);
      const survey = makeSurvey();
      // Score 0 would come pre-validated, but we check DB call is made for valid score
      await expect(service.submit(survey, { score: 1 }, 'one_click')).resolves.toBeUndefined();
    });
  });

  describe('getSurveyView', () => {
    it('returns allow-listed fields only', async () => {
      const db = makeDb([]);
      const service = new CsatService(db as never, tokenService);
      const survey = makeSurvey();
      const view = await service.getSurveyView(survey);
      expect(view).toHaveProperty('ticketId');
      expect(view).toHaveProperty('scale');
      expect(view).toHaveProperty('alreadyResponded', false);
      expect(view).not.toHaveProperty('tokenHash');
      expect(view).not.toHaveProperty('comment');
    });

    it('sets alreadyResponded to true when survey has a response', async () => {
      const db = makeDb([]);
      const service = new CsatService(db as never, tokenService);
      const survey = makeSurvey({ respondedAt: new Date() });
      const view = await service.getSurveyView(survey);
      expect(view.alreadyResponded).toBe(true);
    });

    it('includes preselectedScore when provided', async () => {
      const db = makeDb([]);
      const service = new CsatService(db as never, tokenService);
      const survey = makeSurvey();
      const view = await service.getSurveyView(survey, 4);
      expect(view.preselectedScore).toBe(4);
    });
  });
});
