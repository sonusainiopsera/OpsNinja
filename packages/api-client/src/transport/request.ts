/**
 * Core transport — typed fetch wrapper.
 *
 * Every request is sent with:
 *   - credentials: 'include'  (httpOnly SameSite=Strict cookie is browser-managed)
 *   - Accept / Content-Type: application/json
 *   - X-Correlation-Id: caller-supplied or auto-generated per-request UUID
 *   - AbortController-backed timeout
 *
 * Responses:
 *   - 2xx: parsed as T or returned raw (callers choose)
 *   - non-2xx: parsed into ApiError via parseErrorEnvelope
 *   - Network / timeout: wrapped in a transport ApiError with code TRANSPORT_ERROR
 */

import { ApiError } from '../errors/ApiError';
import { parseErrorEnvelope } from '../errors/parseErrorEnvelope';

export interface RequestConfig {
  baseUrl: string;
  /** Default request timeout in ms. Default: 15_000. */
  timeoutMs?: number;
  /** Injected fetch implementation (default: globalThis.fetch). */
  fetch?: typeof globalThis.fetch;
  /** Called with a synthetic traceId when none arrives from the server. */
  generateId?: () => string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  correlationId?: string;
  /** Set by SessionManager to prevent recursive refresh attempts. */
  _isReplay?: boolean;
}

export type RequestFn = <T = unknown>(opts: RequestOptions) => Promise<T>;

const TRANSPORT_TRACE_ID = 'transport-error';
let idCounter = 0;
function defaultGenerateId(): string {
  return `cid-${Date.now()}-${++idCounter}`;
}

export function createRequestFn(config: RequestConfig): RequestFn {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 15_000;
  const generateId = config.generateId ?? defaultGenerateId;

  return async function request<T = unknown>(opts: RequestOptions): Promise<T> {
    const correlationId = opts.correlationId ?? generateId();
    const url = buildUrl(config.baseUrl, opts.path, opts.query);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Correlation-Id': correlationId,
    };

    let body: string | undefined;
    if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort('timeout'), timeoutMs);

    // Merge caller signal with our timeout signal.
    const signal = opts.signal
      ? anySignal([opts.signal, controller.signal])
      : controller.signal;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: opts.method ?? 'GET',
        headers,
        body,
        credentials: 'include',
        signal,
      });
    } catch (err) {
      clearTimeout(timeoutHandle);
      const message =
        err instanceof Error && err.name === 'AbortError'
          ? opts.signal?.aborted
            ? 'Request aborted by caller'
            : 'Request timed out'
          : 'Network error';
      const code =
        err instanceof Error && err.name === 'AbortError'
          ? opts.signal?.aborted
            ? 'REQUEST_ABORTED'
            : 'REQUEST_TIMEOUT'
          : 'TRANSPORT_ERROR';
      throw new ApiError({
        status: 0,
        code,
        message,
        details: [],
        traceId: correlationId,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      const err = await parseErrorEnvelope(response, correlationId);
      throw err;
    }

    // 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError({
        status: response.status,
        code: 'RESPONSE_PARSE_ERROR',
        message: 'Server returned a non-JSON response body',
        details: [],
        traceId: correlationId,
      });
    }
  };
}

function buildUrl(
  base: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string {
  const url = new URL(path, base.endsWith('/') ? base : `${base}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/** Abort as soon as any of the provided signals fires. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}
