/**
 * TokenService — stateless JWT access token minting and verification.
 *
 * Uses RS256 (asymmetric RSA) so workers and the realtime gateway can verify
 * tokens against the public JWKS without calling this service. Key material is
 * loaded from environment variables (PEM-encoded). Key rotation is supported
 * via the `kid` header: expose a new key alongside the old one and rotate the
 * signing key — old tokens remain verifiable until they expire (≤15 min).
 *
 * No token value is ever logged. All operations are synchronous (crypto is CPU-
 * bound but fast for RS256 at 2048-bit key size).
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, KeyObject } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

import type {
  AccessTokenClaims,
  IssuedAccessToken,
  JsonWebKeySet,
  MintTokenInput,
  SigningKey,
} from '../interfaces/token-claims.interface';

export const ACCESS_TOKEN_TTL_SECONDS = 900; // 15 minutes

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly signingKey: SigningKey;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(private readonly config: ConfigService) {
    this.issuer = config.get<string>('AUTH_ISSUER', 'https://api.opsninja.io');
    this.audience = config.get<string>('AUTH_AUDIENCE', 'opsninja');

    const privateKeyPem = config.get<string>('AUTH_PRIVATE_KEY', '');
    const publicKeyPem = config.get<string>('AUTH_PUBLIC_KEY', '');
    const kid = config.get<string>('AUTH_KID', 'default-key-1');

    this.signingKey = { privateKeyPem, publicKeyPem, kid };

    if (!privateKeyPem) {
      this.logger.warn(
        'AUTH_PRIVATE_KEY not set — token minting will fail. ' +
          'Set AUTH_PRIVATE_KEY (PEM) in environment.',
      );
    }
  }

  /**
   * Mint a new access token for the given principal.
   *
   * @param input   Business-logic claims: sub, tenantId, roles, etc.
   * @param nowMs   Injectable clock (unix ms). Defaults to Date.now().
   */
  mintAccessToken(input: MintTokenInput, nowMs?: number): IssuedAccessToken {
    const now = Math.floor((nowMs ?? Date.now()) / 1000); // unix seconds
    const jti = randomUUID();

    const claims: Omit<AccessTokenClaims, 'iat' | 'exp' | 'jti'> = {
      sub: input.sub,
      tenant_id: input.tenantId,
      roles: input.roles,
      org_scope_version: input.orgScopeVersion,
      user_type: input.userType,
      iss: this.issuer,
      aud: this.audience,
    };

    const accessToken = jwt.sign(
      { ...claims, jti },
      this.signingKey.privateKeyPem,
      {
        algorithm: 'RS256',
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        notBefore: 0,
        keyid: this.signingKey.kid,
        // jwt.sign sets iat automatically; we pass nowMs for test determinism
        ...(nowMs !== undefined ? { header: { kid: this.signingKey.kid, alg: 'RS256' } } : {}),
      },
    );

    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      expiresAt: new Date((now + ACCESS_TOKEN_TTL_SECONDS) * 1000),
      jti,
    };
  }

  /**
   * Verify and decode an access token. Throws on invalid/expired tokens.
   * Used internally and by workers that inject the public key directly.
   */
  verifyAccessToken(token: string): AccessTokenClaims {
    const decoded = jwt.verify(token, this.signingKey.publicKeyPem, {
      algorithms: ['RS256'],
      issuer: this.issuer,
      audience: this.audience,
    });
    return decoded as AccessTokenClaims;
  }

  /**
   * Returns the public JWKS so that workers/realtime-gateway can verify
   * tokens without calling this service. Exposed at GET /.well-known/jwks.json.
   */
  getPublicJwks(): JsonWebKeySet {
    if (!this.signingKey.publicKeyPem) {
      return { keys: [] };
    }

    const publicKey: KeyObject = createPublicKey(this.signingKey.publicKeyPem);
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, string>;

    return {
      keys: [
        {
          ...jwk,
          use: 'sig',
          alg: 'RS256',
          kid: this.signingKey.kid,
        } as JsonWebKey,
      ],
    };
  }

  /** Expose kid for audit events. */
  getCurrentKid(): string {
    return this.signingKey.kid;
  }
}
