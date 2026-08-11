/**
 * Verifies that the log redactor strips all credential fields.
 * Acceptance criterion: no token, code, state secret or client secret appears
 * in structured logs (tested against a payload containing all four).
 */

import { redactLogRecord } from '@opsninja/observability';

describe('Log redactor — credential field coverage', () => {
  it('redacts access_token', () => {
    const obj = { access_token: 'eyJhbGciOiJSUzI1NiJ9.payload.sig' };
    redactLogRecord(obj);
    expect(obj.access_token).toBe('[REDACTED]');
  });

  it('redacts refresh_token', () => {
    const obj = { refresh_token: 'long-refresh-secret-value' };
    redactLogRecord(obj);
    expect(obj.refresh_token).toBe('[REDACTED]');
  });

  it('redacts token', () => {
    const obj = { token: 'bearer-token-value' };
    redactLogRecord(obj);
    expect(obj.token).toBe('[REDACTED]');
  });

  it('redacts code', () => {
    const obj = { code: 'authorization-code-12345' };
    redactLogRecord(obj);
    expect(obj.code).toBe('[REDACTED]');
  });

  it('redacts code_verifier', () => {
    const obj = { code_verifier: 'pkce-verifier-base64url' };
    redactLogRecord(obj);
    expect(obj.code_verifier).toBe('[REDACTED]');
  });

  it('redacts client_secret', () => {
    const obj = { client_secret: 'oauth-client-secret-value' };
    redactLogRecord(obj);
    expect(obj.client_secret).toBe('[REDACTED]');
  });

  it('redacts api_token', () => {
    const obj = { api_token: 'atlassian-api-token-value' };
    redactLogRecord(obj);
    expect(obj.api_token).toBe('[REDACTED]');
  });

  it('redacts state', () => {
    const obj = { state: 'random-oauth-state-value' };
    redactLogRecord(obj);
    expect(obj.state).toBe('[REDACTED]');
  });

  it('redacts a combined payload containing all credential fields', () => {
    const record = {
      operation: 'jira.token_exchange',
      tenant_id: 'tenant-1',
      token: 'access-token-abc',
      refresh_token: 'refresh-token-xyz',
      code: 'auth-code-111',
      code_verifier: 'pkce-verifier-222',
      client_secret: 'client-secret-333',
      api_token: 'api-token-444',
      state: 'oauth-state-555',
      access_token: 'access-token-666',
    };

    redactLogRecord(record);

    expect(record.token).toBe('[REDACTED]');
    expect(record.refresh_token).toBe('[REDACTED]');
    expect(record.code).toBe('[REDACTED]');
    expect(record.code_verifier).toBe('[REDACTED]');
    expect(record.client_secret).toBe('[REDACTED]');
    expect(record.api_token).toBe('[REDACTED]');
    expect(record.state).toBe('[REDACTED]');
    expect(record.access_token).toBe('[REDACTED]');

    // Non-credential fields are not redacted
    expect(record.operation).toBe('jira.token_exchange');
    expect(record.tenant_id).toBe('tenant-1');
  });

  it('redacts credentials nested inside a log envelope object', () => {
    const record = {
      level: 'info',
      msg: 'token refreshed',
      ctx: {
        tokens: {
          access_token: 'nested-access-token',
          refresh_token: 'nested-refresh-token',
        },
      },
    };

    redactLogRecord(record);

    expect((record.ctx as any).tokens.access_token).toBe('[REDACTED]');
    expect((record.ctx as any).tokens.refresh_token).toBe('[REDACTED]');
    expect(record.msg).toBe('token refreshed'); // safe field untouched
  });
});
