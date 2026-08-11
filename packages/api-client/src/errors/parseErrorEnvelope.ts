import { ApiError, type ErrorDetail } from './ApiError';

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
    traceId?: string;
    currentVersion?: string;
  };
}

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b['error'] !== 'object' || b['error'] === null) return false;
  const e = b['error'] as Record<string, unknown>;
  return typeof e['code'] === 'string' && typeof e['message'] === 'string';
}

function parseRetryAfter(headers: Headers): number | undefined {
  const header = headers.get('retry-after');
  if (!header) return undefined;

  // Delta-seconds form: "120"
  const seconds = Number(header);
  if (!isNaN(seconds) && isFinite(seconds)) {
    return Math.max(0, seconds) * 1000;
  }

  // HTTP-date form: "Thu, 01 Jan 2026 00:00:00 GMT"
  const date = Date.parse(header);
  if (!isNaN(date)) {
    const delayMs = date - Date.now();
    // Clock skew: treat past dates as immediate (minimum jitter only)
    return Math.max(0, delayMs);
  }

  return undefined;
}

export async function parseErrorEnvelope(
  response: Response,
): Promise<ApiError> {
  const status = response.status;
  const retryAfterMs = status === 429 ? parseRetryAfter(response.headers) : undefined;

  let body: unknown = null;
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      body = await response.json();
    } catch {
      // malformed JSON — fall through to synthetic error
    }
  } else {
    // Non-JSON body (HTML error page etc.) — discard it, produce synthetic error
    try {
      await response.text(); // consume the body to avoid resource leak
    } catch {
      // ignore
    }
  }

  if (isErrorEnvelope(body)) {
    const { code, message, details, traceId, currentVersion } = body.error;
    const extraDetails: ErrorDetail[] = details ?? [];
    if (currentVersion !== undefined) {
      extraDetails.push({ field: '_currentVersion', message: currentVersion });
    }
    return new ApiError({ status, code, message, details: extraDetails, traceId, retryAfterMs });
  }

  // Synthetic error for malformed / non-JSON / empty bodies
  return new ApiError({
    status,
    code: 'RESPONSE_PARSE_ERROR',
    message: `Unexpected response: HTTP ${status}`,
    details: [],
    traceId: '',
    retryAfterMs,
  });
}
