import { DefaultRedactor } from './redaction.port';

describe('DefaultRedactor', () => {
  const redactor = new DefaultRedactor();

  it('redacts email addresses in string values', () => {
    const result = redactor.redact({ subject: 'Contact user@example.com today' });
    expect(JSON.stringify(result)).not.toContain('user@example.com');
  });

  it('replaces confidential key email entirely', () => {
    const result = redactor.redact({ email: 'user@example.com' });
    expect(result['email']).toBe('[REDACTED]');
  });

  it('replaces comment body field', () => {
    const result = redactor.redact({ body: 'Some free-text comment body' });
    expect(result['body']).toBe('[REDACTED]');
  });

  it('replaces ip_address field', () => {
    const result = redactor.redact({ ipAddress: '192.168.1.1' });
    expect(result['ipAddress']).toBe('[REDACTED]');
  });

  it('redacts nested confidential fields', () => {
    const result = redactor.redact({
      ticket: {
        id: 'abc',
        contact: { email: 'contact@example.com' },
      },
    }) as { ticket: { contact: { email: string } } };
    expect(result.ticket.contact.email).toBe('[REDACTED]');
  });

  it('does not mutate the input object', () => {
    const input = { email: 'user@example.com', status: 'open' };
    redactor.redact(input);
    expect(input.email).toBe('user@example.com');
  });

  it('passes non-confidential fields through unchanged', () => {
    const result = redactor.redact({ status: 'open', priority: 'P2' });
    expect(result).toEqual({ status: 'open', priority: 'P2' });
  });

  it('handles arrays', () => {
    const result = redactor.redact({
      comments: [
        { body: 'Secret comment', id: '1' },
        { body: 'Another secret', id: '2' },
      ],
    }) as { comments: Array<{ body: string; id: string }> };
    expect(result.comments[0]!.body).toBe('[REDACTED]');
    expect(result.comments[1]!.body).toBe('[REDACTED]');
    expect(result.comments[0]!.id).toBe('1');
  });
});
