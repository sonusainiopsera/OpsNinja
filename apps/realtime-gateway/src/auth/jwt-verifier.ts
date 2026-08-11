/**
 * JwtVerifier – lightweight JWT verification for the realtime gateway.
 *
 * Verifies RS256 access tokens against the public key from config.
 * No Postgres dependency: public key is supplied via JWT_PUBLIC_KEY env var.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

export interface GatewayTokenClaims {
  sub: string;
  tenant_id: string;
  roles: string[];
  org_scope_version: number;
  org_scope_ids?: string[];
  user_type: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

export interface WsPrincipal {
  principalId: string;
  tenantId: string;
  roles: string[];
  orgScopeIds: Set<string>;
  orgScopeVersion: number;
  userType: string;
  jti: string;
}

@Injectable()
export class JwtVerifier {
  private readonly logger = new Logger(JwtVerifier.name);
  private readonly publicKey: string;
  private readonly audience: string;

  constructor(private readonly config: ConfigService) {
    this.publicKey = this.config.get<string>('JWT_PUBLIC_KEY', '');
    this.audience = this.config.get<string>('JWT_AUDIENCE', 'opsninja');
  }

  /**
   * Verifies the token and returns extracted principal.
   * Throws on any failure so callers can close with 4401.
   */
  verify(token: string): WsPrincipal {
    if (!this.publicKey) {
      throw new Error('JWT_PUBLIC_KEY not configured');
    }

    const claims = jwt.verify(token, this.publicKey, {
      algorithms: ['RS256'],
      audience: this.audience,
    }) as GatewayTokenClaims;

    return {
      principalId: claims.sub,
      tenantId: claims.tenant_id,
      roles: claims.roles,
      orgScopeIds: new Set(claims.org_scope_ids ?? []),
      orgScopeVersion: claims.org_scope_version ?? 0,
      userType: claims.user_type,
      jti: claims.jti,
    };
  }

  /**
   * Returns true when the token's exp claim is in the past.
   * Uses jwt.decode without signature check — call only after verify failed.
   */
  isExpired(token: string): boolean {
    try {
      const decoded = jwt.decode(token) as { exp?: number } | null;
      if (!decoded?.exp) return false;
      return decoded.exp < Math.floor(Date.now() / 1000);
    } catch {
      return false;
    }
  }
}
