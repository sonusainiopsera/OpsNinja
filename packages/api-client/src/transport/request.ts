import { ApiError } from '../errors/ApiError';
import { parseErrorEnvelope } from '../errors/parseErrorEnvelope';

export interface ClientConfig {
  baseUrl: string;
  /** Default request timeout in milliseconds (default: 15 000) */
  timeoutMs?: number;
  /** Injectable fetch for testing */
  fetch?: typeof globalThis.fetch;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  /** Skip adding the attempt-marker header (used internally by refresh) */
  _isRefresh?: boolean;
  /** Internal: marks a replayed request so SessionManager can apply loop guard */
  _isReplay?: boolean;
}

function buildUrl(baseUrl: string, path: string, params?: RequestOptions['params']): string {
  const url = new URL(path.startsWith('/') ? path.slice(1) : path, baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function generateCorrelationId(): string {
  // crypto.randomUUID is available in modern browsers and Node >=14.17
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function request<T>(
  config: ClientConfig,
  options: RequestOptions,
): Promise<T> {
  const fetchFn = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // If the caller passed their own signal, propagate their abort too
  const externalSignal = options.signal;
  let externalAbortListener: (() => void) | undefined;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new ApiError({ status: 0, code: 'REQUEST_ABORTED', message: 'Request was aborted' });
    }
    externalAbortListener = () => controller.abort();
    externalSignal.addEventListener('abort', externalAbortListener);
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Correlation-Id': generateCorrelationId(),
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    let response: Response;
    try {
      response = await fetchFn(
        buildUrl(config.baseUrl, options.path, options.params),
        {
          method: options.method ?? 'GET',
          credentials: 'include',
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        },
      );
    } catch (err) {
      // Network error (offline, DNS failure, timeout abort)
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiError({ status: 0, code: 'REQUEST_ABORTED', message: 'Request timed out or was aborted' });
      }
      throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: err instanceof Error ? err.message : 'Network error' });
    }

    if (response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        // 200 with non-JSON body — parse error
        await response.text().catch(() => undefined);
        throw new ApiError({ status: response.status, code: 'RESPONSE_PARSE_ERROR', message: 'Expected JSON response' });
      }
      try {
        return (await response.json()) as T;
      } catch {
        throw new ApiError({ status: response.status, code: 'RESPONSE_PARSE_ERROR', message: 'Failed to parse JSON response' });
      }
    }

    throw await parseErrorEnvelope(response);
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal && externalAbortListener) {
      externalSignal.removeEventListener('abort', externalAbortListener);
    }
  }
}
