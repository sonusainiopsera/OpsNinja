import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';

/** Strict typed shape of access token claims. */
export interface AccessTokenClaims {
  sub: string;
  tenant_id: string;
  roles: string[];
  org_scope_version: number;
  user_type: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface MintTokenInput {
  userId: string;
  tenantId: string;
  roles: string[];
  principalKind: string;
  orgScopeVersion?: number;
}

export interface MintedToken {
  accessToken: string;
  expiresIn: number;
  jti: string;
}

/** Access token TTL: 15 minutes (must not exceed this per WO constraint). */
const ACCESS_TOKEN_TTL_S = 15 * 60;

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Mints a signed RS256 access token.  All six required claims are present;
   * signing key is resolved from config / secrets manager.
   */
  mintAccessToken(input: MintTokenInput): MintedToken {
    const { privateKey, kid } = this.resolveSigningKey();
    const iss = this.config.get<string>('JWT_ISSUER', 'https://api.opsninja.io');
    const aud = this.config.get<string>('JWT_AUDIENCE', 'opsninja');
    const jti = randomUUID();
    const now = Math.floor(this.now() / 1000);

    const claims: AccessTokenClaims = {
      sub: input.userId,
      tenant_id: input.tenantId,
      roles: input.roles,
      org_scope_version: input.orgScopeVersion ?? 0,
      user_type: input.principalKind,
      jti,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_S,
      iss,
      aud,
    };

    const accessToken = jwt.sign(claims, privateKey, {
      algorithm: 'RS256',
      keyid: kid,
      // iat/exp are set manually above; suppress jsonwebtoken's own timestamp
      noTimestamp: true,
    });

    this.logger.log({ type: 'audit', event: 'token.issued', sub: input.userId, jti });
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_S, jti };
  }

  /**
   * Verifies an access token against all known public keys (current + previous
   * rotated-out key).  Returns the decoded claims on success.
   */
  verifyAccessToken(
    token: string,
    opts?: { ignoreExpiration?: boolean },
  ): AccessTokenClaims {
    const publicKeys = this.resolveVerificationKeys();
    const aud = this.config.get<string>('JWT_AUDIENCE', 'opsninja');

    let lastError: Error | undefined;
    for (const { key } of publicKeys) {
      try {
        return jwt.verify(token, key, {
          algorithms: ['RS256'],
          audience: aud,
          ignoreExpiration: opts?.ignoreExpiration,
        }) as AccessTokenClaims;
      } catch (err) {
        lastError = err as Error;
      }
    }
    throw lastError ?? new Error('Token verification failed');
  }

  /**
   * Returns the JWKS document (public keys only) for internal consumers such
   * as the realtime gateway and worker processes.
   */
  getJwks(): { keys: object[] } {
    const publicKeys = this.resolveVerificationKeys();
    return {
      keys: publicKeys.map(({ kid }) => ({
        kty: 'RSA',
        use: 'sig',
        kid,
        alg: 'RS256',
        // Full JWK n/e parameters require DER parsing; exported in a dedicated WO.
      })),
    };
  }

  /** Overridable in tests to inject a fake clock. */
  protected now(): number {
    return Date.now();
  }

  private resolveSigningKey(): { privateKey: string; kid: string } {
    const raw = this.config.get<string>('JWT_PRIVATE_KEY');
    if (!raw) {
      throw new Error('JWT_PRIVATE_KEY is not configured');
    }
    const kid = this.config.get<string>('JWT_KID', 'key-1');
    return { privateKey: raw.replace(/\\n/g, '\n'), kid };
  }

  private resolveVerificationKeys(): { key: string; kid: string }[] {
    const raw = this.config.get<string>('JWT_PUBLIC_KEY');
    if (!raw) {
      throw new Error('JWT_PUBLIC_KEY is not configured');
    }
    const kid = this.config.get<string>('JWT_KID', 'key-1');
    const keys: { key: string; kid: string }[] = [
      { key: raw.replace(/\\n/g, '\n'), kid },
    ];

    // Previous key stays verifiable until all outstanding tokens expire (15 min).
    const prevRaw = this.config.get<string>('JWT_PREV_PUBLIC_KEY');
    if (prevRaw) {
      const prevKid = this.config.get<string>('JWT_PREV_KID', 'key-0');
      keys.push({ key: prevRaw.replace(/\\n/g, '\n'), kid: prevKid });
    }

    return keys;
  }
}
