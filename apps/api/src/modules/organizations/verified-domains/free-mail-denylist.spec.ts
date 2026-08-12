/**
 * Unit tests for the free-mail/disposable domain deny-list (WO-028).
 *
 * Covers:
 *   - Exact matches on well-known free-mail providers
 *   - Exact matches on disposable address providers
 *   - Subdomain fallback (mail.yahoo.com → denied because yahoo.com is listed)
 *   - Non-listed business domains are allowed
 *   - Case insensitivity
 */

import { isDeniedDomain, FREE_MAIL_DOMAINS, DISPOSABLE_DOMAINS } from './free-mail-denylist';

describe('isDeniedDomain — free-mail providers', () => {
  it('denies gmail.com', () => {
    expect(isDeniedDomain('gmail.com')).toBe(true);
  });

  it('denies outlook.com', () => {
    expect(isDeniedDomain('outlook.com')).toBe(true);
  });

  it('denies yahoo.com', () => {
    expect(isDeniedDomain('yahoo.com')).toBe(true);
  });

  it('denies hotmail.com', () => {
    expect(isDeniedDomain('hotmail.com')).toBe(true);
  });

  it('denies icloud.com', () => {
    expect(isDeniedDomain('icloud.com')).toBe(true);
  });

  it('denies protonmail.com', () => {
    expect(isDeniedDomain('protonmail.com')).toBe(true);
  });

  it('denies mail.ru', () => {
    expect(isDeniedDomain('mail.ru')).toBe(true);
  });

  it('denies qq.com', () => {
    expect(isDeniedDomain('qq.com')).toBe(true);
  });

  it('denies zohomail.com (free tier)', () => {
    expect(isDeniedDomain('zohomail.com')).toBe(true);
  });
});

describe('isDeniedDomain — disposable providers', () => {
  it('denies mailinator.com', () => {
    expect(isDeniedDomain('mailinator.com')).toBe(true);
  });

  it('denies guerrillamail.com', () => {
    expect(isDeniedDomain('guerrillamail.com')).toBe(true);
  });

  it('denies temp-mail.org', () => {
    expect(isDeniedDomain('temp-mail.org')).toBe(true);
  });

  it('denies 10minutemail.com', () => {
    expect(isDeniedDomain('10minutemail.com')).toBe(true);
  });

  it('denies yopmail.com', () => {
    expect(isDeniedDomain('yopmail.com')).toBe(true);
  });

  it('denies trashmail.com', () => {
    expect(isDeniedDomain('trashmail.com')).toBe(true);
  });
});

describe('isDeniedDomain — subdomain fallback', () => {
  it('denies a subdomain of a listed free-mail provider', () => {
    // "mail.yahoo.com" → eTLD+1 is "yahoo.com" which is listed
    expect(isDeniedDomain('mail.yahoo.com')).toBe(true);
  });

  it('denies a subdomain of a listed disposable provider', () => {
    expect(isDeniedDomain('test.mailinator.com')).toBe(true);
  });

  it('does NOT apply subdomain check more than one level deep beyond eTLD+1', () => {
    // For "a.b.gmail.com" — eTLD+1 is "gmail.com" which IS listed
    expect(isDeniedDomain('a.b.gmail.com')).toBe(true);
  });
});

describe('isDeniedDomain — case insensitivity', () => {
  it('denies uppercase GMAIL.COM', () => {
    expect(isDeniedDomain('GMAIL.COM')).toBe(true);
  });

  it('denies mixed-case Gmail.Com', () => {
    expect(isDeniedDomain('Gmail.Com')).toBe(true);
  });
});

describe('isDeniedDomain — allowed business domains', () => {
  it('allows acmecorp.com', () => {
    expect(isDeniedDomain('acmecorp.com')).toBe(false);
  });

  it('allows example.org', () => {
    expect(isDeniedDomain('example.org')).toBe(false);
  });

  it('allows a company on a country TLD', () => {
    expect(isDeniedDomain('mycompany.co.uk')).toBe(false);
  });

  it('allows zoho.com (the business Zoho, distinct from zohomail.com)', () => {
    // "zoho.com" is NOT in the deny list — businesses use zoho.com not zohomail.com
    expect(isDeniedDomain('zoho.com')).toBe(false);
  });
});

describe('deny-list data integrity', () => {
  it('FREE_MAIL_DOMAINS contains at least 30 entries (sanity check against accidental truncation)', () => {
    expect(FREE_MAIL_DOMAINS.size).toBeGreaterThanOrEqual(30);
  });

  it('DISPOSABLE_DOMAINS contains at least 30 entries', () => {
    expect(DISPOSABLE_DOMAINS.size).toBeGreaterThanOrEqual(30);
  });

  it('all entries in FREE_MAIL_DOMAINS are lowercase', () => {
    for (const domain of FREE_MAIL_DOMAINS) {
      expect(domain).toBe(domain.toLowerCase());
    }
  });

  it('all entries in DISPOSABLE_DOMAINS are lowercase', () => {
    for (const domain of DISPOSABLE_DOMAINS) {
      expect(domain).toBe(domain.toLowerCase());
    }
  });

  it('no entry has a leading or trailing dot', () => {
    const all = [...FREE_MAIL_DOMAINS, ...DISPOSABLE_DOMAINS];
    for (const domain of all) {
      expect(domain.startsWith('.')).toBe(false);
      expect(domain.endsWith('.')).toBe(false);
    }
  });
});
