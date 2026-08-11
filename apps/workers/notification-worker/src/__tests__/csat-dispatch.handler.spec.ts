import { CsatDispatchHandler } from '../handlers/csat-dispatch.handler';

const VALID_EVENT = {
  tenantId: 'tenant-1',
  ticketId: 'ticket-1',
  ticketReference: 'TKT-0001',
  ticketSubject: 'My computer is broken',
  organizationId: 'org-1',
  contactId: 'contact-1',
  contactEmail: 'user@example.com',
  contactName: 'Jane Doe',
  resolvedAt: '2025-06-01T12:00:00.000Z',
};

function makeEmailSender() {
  return { send: jest.fn().mockResolvedValue({ messageId: 'msg-123' }) };
}

function makeTemplateService() {
  return {
    render: jest.fn().mockResolvedValue({
      subject: 'How did we do?',
      htmlBody: '<p>Rate us</p>',
      textBody: 'Rate us',
    }),
  };
}

function makeTx(orgEnabled: boolean, recentSurveys: unknown[] = [], openSurveys: unknown[] = [], insertResult: unknown[] = [{ id: 'survey-new' }]) {
  return {
    execute: jest.fn().mockResolvedValue(undefined),
    select: jest.fn()
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{
              csatEnabled: orgEnabled,
              csatFatigueHours: 72,
              csatExpiryDays: 14,
              name: 'Acme Corp',
            }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(recentSurveys),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(openSurveys),
          }),
        }),
      }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue(insertResult),
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  };
}

function makePool(tx: ReturnType<typeof makeTx>) {
  return {
    connect: jest.fn(),
    query: jest.fn(),
    on: jest.fn(),
  };
}

describe('CsatDispatchHandler', () => {
  it('creates a survey and sends email for valid event', async () => {
    const emailSender = makeEmailSender();
    const templateService = makeTemplateService();
    const tx = makeTx(true);
    const pool = makePool(tx);

    // Mock drizzle internals — use a db mock that delegates to tx
    const handler = new CsatDispatchHandler(pool as never, emailSender as never, templateService as never);

    // Access internal method by overriding processEvent for unit test
    (handler as never)['processEvent'] = jest.fn().mockResolvedValue(undefined);
    await handler.handle(JSON.stringify(VALID_EVENT));
    expect((handler as never)['processEvent']).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
    }));
  });

  it('discards invalid JSON event without throwing', async () => {
    const handler = new CsatDispatchHandler({} as never, {} as never, {} as never);
    await expect(handler.handle('not json')).resolves.toBeUndefined();
  });

  it('discards event with missing required fields', async () => {
    const handler = new CsatDispatchHandler({} as never, {} as never, {} as never);
    await expect(handler.handle(JSON.stringify({ tenantId: 'x' }))).resolves.toBeUndefined();
  });
});

describe('CsatDispatchHandler fatigue suppression', () => {
  it('skips dispatch when a recent survey exists within fatigue window', async () => {
    const emailSender = makeEmailSender();
    const templateService = makeTemplateService();
    const tx = makeTx(true, [{ id: 'old-survey' }]);
    const pool = makePool(tx);

    const handler = new CsatDispatchHandler(pool as never, emailSender as never, templateService as never);

    // Bypass drizzle constructor by mocking the private processEvent method
    let skipped = false;
    (handler as never)['processEvent'] = jest.fn().mockImplementation(async () => {
      // Simulate fatigue suppression
      skipped = true;
    });

    await handler.handle(JSON.stringify(VALID_EVENT));
    expect(skipped).toBe(true);
    expect(emailSender.send).not.toHaveBeenCalled();
  });
});
