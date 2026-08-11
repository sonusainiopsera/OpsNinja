/**
 * Unit tests for WsJwtVerifier (WO-066 AC #2, #10).
 */

import 'reflect-metadata';
import { WsJwtVerifier } from './ws-jwt.verifier';
import {
  FIXTURE_TOKEN_AGENT_A,
  FIXTURE_TOKEN_MANAGER_B,
  FIXTURE_TOKEN_EXPIRED,
  FIXTURE_TOKEN_PORTAL,
  TEST_RSA_PUBLIC_KEY,
  TENANT_A_ID,
  TENANT_B_ID,
  AGENT_A_ID,
  MANAGER_B_ID,
} from '../../test/fixtures/jwt.fixtures';

describe('WsJwtVerifier', () => {
  let verifier: WsJwtVerifier;

  beforeAll(() => {
    process.env['AUTH_PUBLIC_KEY'] = TEST_RSA_PUBLIC_KEY;
    process.env['AUTH_ISSUER'] = 'https://api.opsninja.io';
    process.env['AUTH_AUDIENCE'] = 'opsninja';
  });

  beforeEach(() => {
    verifier = new WsJwtVerifier();
  });

  describe('verify()', () => {
    it('returns principal for a valid agent token', () => {
      const principal = verifier.verify(FIXTURE_TOKEN_AGENT_A);
      expect(principal).not.toBeNull();
      expect(principal!.sub).toBe(AGENT_A_ID);
      expect(principal!.tenantId).toBe(TENANT_A_ID);
    });

    it('returns principal for a valid manager token', () => {
      const principal = verifier.verify(FIXTURE_TOKEN_MANAGER_B);
      expect(principal).not.toBeNull();
      expect(principal!.sub).toBe(MANAGER_B_ID);
      expect(principal!.tenantId).toBe(TENANT_B_ID);
    });

    it('returns null for an expired token', () => {
      const principal = verifier.verify(FIXTURE_TOKEN_EXPIRED);
      expect(principal).toBeNull();
    });

    it('returns null for a portal token (wrong user_type)', () => {
      const principal = verifier.verify(FIXTURE_TOKEN_PORTAL);
      expect(principal).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(verifier.verify('')).toBeNull();
    });

    it('returns null for a garbage string', () => {
      expect(verifier.verify('not-a-jwt')).toBeNull();
    });

    it('returns null when AUTH_PUBLIC_KEY is not set', () => {
      const savedKey = process.env['AUTH_PUBLIC_KEY'];
      delete process.env['AUTH_PUBLIC_KEY'];
      const v = new WsJwtVerifier();
      expect(v.verify(FIXTURE_TOKEN_AGENT_A)).toBeNull();
      process.env['AUTH_PUBLIC_KEY'] = savedKey;
    });
  });

  describe('extractBearer()', () => {
    it('extracts token from valid Authorization header', () => {
      const token = verifier.extractBearer('Bearer eyJhbGciOiJSUzI1NiJ9.stub.sig');
      expect(token).toBe('eyJhbGciOiJSUzI1NiJ9.stub.sig');
    });

    it('is case-insensitive for Bearer prefix', () => {
      expect(verifier.extractBearer('bearer eyJ.stub.sig')).toBe('eyJ.stub.sig');
    });

    it('returns null for undefined header', () => {
      expect(verifier.extractBearer(undefined)).toBeNull();
    });

    it('returns null for header without Bearer prefix', () => {
      expect(verifier.extractBearer('Token something')).toBeNull();
    });

    it('returns null for bare "Bearer" with no token', () => {
      expect(verifier.extractBearer('Bearer')).toBeNull();
    });
  });

  describe('extractFromSubprotocol()', () => {
    it('extracts token from single opsninja-token protocol', () => {
      const token = verifier.extractFromSubprotocol('opsninja-token-eyJ.stub');
      expect(token).toBe('eyJ.stub');
    });

    it('extracts token when mixed with other protocols', () => {
      const token = verifier.extractFromSubprotocol('chat, opsninja-token-eyJ.stub, json');
      expect(token).toBe('eyJ.stub');
    });

    it('returns null for undefined header', () => {
      expect(verifier.extractFromSubprotocol(undefined)).toBeNull();
    });

    it('returns null when no matching subprotocol', () => {
      expect(verifier.extractFromSubprotocol('chat, json')).toBeNull();
    });
  });
});
