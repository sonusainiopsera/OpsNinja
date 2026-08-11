/**
 * JWT verifier for the Realtime Gateway.
 *
 * Uses the same RS256 key material as the main API but is self-contained —
 * no dependency on apps/api or the identity module. Key material is loaded
 * from environment variables at construction time.
 *
 * SECURITY:
 * - No token value is ever logged.
 * - Any error during verification returns null (fail-closed).
 * - The public key is required; missing key → all tokens rejected.
 */

import { Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import type { SocketPrincipal } from '../gateway/frame.types';

interface RawClaims {
  sub: string;
  tenant_id: string;
  roles: string[];
  org_scope_version: number;
  user_type: string;
  exp: number;
  iss: string;
  aud: string | string[];
}

@Injectable()
export class WsJwtVerifier {
  private readonly logger = new Logger(WsJwtVerifier.name);
  private readonly publicKeyPem: string;
  private readonly issuer: string;
  private readonly audience: string;

  constructor() {
    this.publicKeyPem = process.env['AUTH_PUBLIC_KEY'] ?? '';
    this.issuer = process.env['AUTH_ISSUER'] ?? 'https://api.opsninja.io';
    this.audience = process.env['AUTH_AUDIENCE'] ?? 'opsninja';

    if (!this.publicKeyPem) {
      this.logger.warn('AUTH_PUBLIC_KEY not set — all WebSocket auth will fail closed');
    }
  }

  /**
   * Verify a Bearer token and extract the principal.
   * Returns null if the token is missing, invalid, or expired.
   * Never throws; never logs the token value.
   */
  verify(token: string): SocketPrincipal | null {
    if (!this.publicKeyPem || !token) return null;

    try {
      const claims = jwt.verify(token, this.publicKeyPem, {
        algorithms: ['RS256'],
        issuer: this.issuer,
        audience: this.audience,
      }) as RawClaims;

      // Only staff/machine tokens are valid on the gateway (not portal tokens).
      if (claims.user_type === 'portal') return null;

      return {
        sub: claims.sub,
        tenantId: claims.tenant_id,
        roles: claims.roles,
        orgScopeVersion: claims.org_scope_version,
        orgScopeIds: new Set<string>(), // populated separately from org_scope claim
        userType: claims.user_type,
      };
    } catch {
      // Deliberately not logging the error message, which may contain token fragments.
      return null;
    }
  }

  /**
   * Extract a Bearer token from the Authorization header value.
   * Returns null if the header is absent or malformed.
   */
  extractBearer(authHeader: string | undefined): string | null {
    if (!authHeader) return null;
    const match = /^Bearer\s+(\S+)$/i.exec(authHeader);
    return match?.[1] ?? null;
  }

  /**
   * Extract a token from the Sec-WebSocket-Protocol header.
   * Some clients pass the token as a subprotocol when the Authorization
   * header is not available (browser WebSocket API limitation).
   * Expected format: "opsninja-token-<base64url-token>"
   */
  extractFromSubprotocol(header: string | undefined): string | null {
    if (!header) return null;
    // Header may contain multiple comma-separated subprotocols.
    const protocols = header.split(',').map((p) => p.trim());
    for (const proto of protocols) {
      if (proto.startsWith('opsninja-token-')) {
        return proto.slice('opsninja-token-'.length);
      }
    }
    return null;
  }
}
