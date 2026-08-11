import { AnonymisationValidator } from '../validation/anonymisation-validator';

describe('AnonymisationValidator', () => {
  it('passes for a clean synthetic record', () => {
    const v = new AnonymisationValidator();
    v.validate({ email: 'user@example.com', name: 'Alice Test', status: 'open' });
    expect(v.isValid()).toBe(true);
  });

  it('flags a real email domain', () => {
    const v = new AnonymisationValidator();
    v.validate({ email: 'user@gmail.com' });
    expect(v.isValid()).toBe(false);
    expect(v.getErrors()[0].rule).toBe('REAL_EMAIL_DOMAIN');
  });

  it('allows all reserved example domains', () => {
    const v = new AnonymisationValidator();
    for (const domain of ['example.com', 'example.org', 'example.net', 'example.invalid']) {
      v.validate({ email: `user@${domain}` });
    }
    expect(v.isValid()).toBe(true);
  });

  it('flags an IPv4 address', () => {
    const v = new AnonymisationValidator();
    v.validate({ ip: '192.168.1.100' });
    expect(v.isValid()).toBe(false);
    expect(v.getErrors()[0].rule).toBe('IPV4_ADDRESS');
  });

  it('flags a credit-card-like number', () => {
    const v = new AnonymisationValidator();
    v.validate({ card: '4111 1111 1111 1111' });
    expect(v.isValid()).toBe(false);
    expect(v.getErrors()[0].rule).toBe('CREDIT_CARD_LIKE');
  });

  it('validates nested objects recursively', () => {
    const v = new AnonymisationValidator();
    v.validate({ metadata: { contact: { email: 'real@company.io' } } });
    expect(v.isValid()).toBe(false);
  });

  it('validateMany checks each record', () => {
    const v = new AnonymisationValidator();
    v.validateMany([
      { email: 'ok@example.com' },
      { email: 'bad@production.io' },
    ]);
    expect(v.getErrors()).toHaveLength(1);
  });

  it('assertValid throws with actionable message', () => {
    const v = new AnonymisationValidator();
    v.validate({ email: 'leak@yahoo.com' });
    expect(() => v.assertValid()).toThrow('Anonymisation validation failed');
  });

  it('assertValid does not throw for clean data', () => {
    const v = new AnonymisationValidator();
    v.validate({ email: 'clean@example.com', count: 42 });
    expect(() => v.assertValid()).not.toThrow();
  });
});
