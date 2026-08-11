/**
 * PII corpus fixture — representative samples for unit and integration tests.
 *
 * Contains:
 *   - RFC5322 email addresses (standard and edge-case formats)
 *   - International phone numbers (E.164 and NANP)
 *   - IPv4 and IPv6 addresses
 *   - JWTs (header.payload.signature format)
 *   - AWS-style access key IDs
 *   - Realistic DevOps log snippets containing PII and secrets
 *
 * Use these values to assert that:
 *   1. redactString() removes every sample from free text.
 *   2. redactObject() removes every sample from structured objects.
 *   3. Anonymised seed output contains no value matching PII patterns.
 */

// ---------------------------------------------------------------------------
// Email addresses
// ---------------------------------------------------------------------------

export const CORPUS_EMAILS = [
  'alice@example.com',
  'bob.smith+tag@subdomain.example.org',
  'carol_42@my-company.co.uk',
  'dave@192.168.1.100', // unusual but RFC-valid
  'eve@xn--nxasmq6b.com', // IDN domain
];

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

export const CORPUS_PHONES_E164 = [
  '+12025550100',
  '+447911123456',
  '+33612345678',
  '+81345678901',
];

export const CORPUS_PHONES_NANP = [
  '(202) 555-0100',
  '202-555-0101',
  '202.555.0102',
  '+1 (800) 555-0103',
  '1-800-555-0104',
];

// ---------------------------------------------------------------------------
// IP addresses
// ---------------------------------------------------------------------------

export const CORPUS_IPV4 = [
  '203.0.113.42',
  '192.168.1.100',
  '10.0.0.1',
  '255.255.255.0',
];

export const CORPUS_IPV6 = [
  '2001:db8::1',
  'fe80::1ff:fe23:4567:890a',
  '::1',
  '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
];

// ---------------------------------------------------------------------------
// JWTs (synthetic — not real tokens)
// ---------------------------------------------------------------------------

export const CORPUS_JWTS = [
  // Standard header.payload.signature format (all base64url segments)
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMyIsInRlbmFudElkIjoiYWJjZCIsImlhdCI6MTcwMDAwMDAwMH0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJvcHNuaW5qYSIsImV4cCI6OTk5OTk5OTk5OX0.AAAA_fake_signature_AAAA',
];

// ---------------------------------------------------------------------------
// AWS-style access key IDs
// ---------------------------------------------------------------------------

export const CORPUS_AWS_KEYS = [
  'AKIAIOSFODNN7EXAMPLE',
  'AKIAI44QH8DHBEXAMPLE',
  'ASIAIOSFODNN7EXAMPLE',   // STS temporary
];

// ---------------------------------------------------------------------------
// High-entropy strings (base64 secrets that should be redacted)
// ---------------------------------------------------------------------------

export const CORPUS_HIGH_ENTROPY = [
  'sk-xJ8mK2pQrN5vL9wT3yU6iO0eA4hC1fB7',  // API key pattern
  'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123',  // GitHub PAT pattern
];

// ---------------------------------------------------------------------------
// Realistic DevOps / Jenkins / Vault log snippets
// ---------------------------------------------------------------------------

export const CORPUS_LOG_SNIPPETS = [
  // Jenkins build log leaking a bearer token
  `[INFO] POST https://api.example.com/webhook Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjaS1ib3QifQ.sig`,

  // Vault audit log leaking a secret
  `2026-01-01T00:00:00Z [AUDIT] secret/data/prod secret_key=AKIAIOSFODNN7EXAMPLE caller=10.0.1.42`,

  // Application debug log with user email and IP
  `DEBUG Request from 203.0.113.42 by alice@example.com at 2026-01-01T12:00:00Z`,

  // Kubernetes pod log with phone number in payload
  `INFO webhook delivery to https://customer.example.com/hooks payload.phone=+12025550100`,

  // Terraform plan output with embedded IPv6
  `resource.aws_vpc.main - cidr 2001:db8::/32 created by bob.smith+tag@subdomain.example.org`,
];

// ---------------------------------------------------------------------------
// Structured objects that must be fully redacted by redactObject()
// ---------------------------------------------------------------------------

export const CORPUS_STRUCTURED_RECORDS = [
  {
    userId: '00000000-0000-0000-0000-000000000001',
    email: 'alice@example.com',
    ipAddress: '203.0.113.42',
    token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.sig',
    body: 'Customer called from +12025550100 asking about their ticket',
  },
  {
    tenantId: 'abc',
    secretCiphertext: 'AQIDAHjLz...base64ciphertext==',
    responseSnippet: '{"error":"auth failed","user":"eve@xn--nxasmq6b.com"}',
    comment: 'Alice (alice@example.com) reported the issue from 192.168.1.100',
  },
];

// ---------------------------------------------------------------------------
// Values that must survive redaction untouched
// ---------------------------------------------------------------------------

export const CORPUS_SAFE_VALUES = [
  // Trace/span/request IDs must never be redacted
  { traceId: 'abc123def456' },
  { requestId: '550e8400-e29b-41d4-a716-446655440000' },
  // Status codes and event types
  { status: 'open', eventType: 'ticket.created' },
  // Timestamps
  { createdAt: '2026-01-01T00:00:00.000Z' },
];
