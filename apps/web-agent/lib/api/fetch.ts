/**
 * Shared browser fetch helper for agent API calls.
 * Prefers NEXT_PUBLIC_API_BASE_URL; falls back to same-origin /api/v1 (Next rewrite).
 */

const API_BASE = (
  (typeof process !== 'undefined' && process.env['NEXT_PUBLIC_API_BASE_URL']) ||
  ''
).replace(/\/$/, '');

/** Build an absolute or same-origin URL from a path like `/api/v1/tickets`. */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (API_BASE) {
    // path may be `/api/v1/...` while base already ends with `/api/v1`
    const normalized = path.startsWith('/api/v1')
      ? path.slice('/api/v1'.length) || '/'
      : path;
    return `${API_BASE}${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
  }
  return path;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const envelope = body as { error?: { message?: string; code?: string; traceId?: string } } | null;
    throw Object.assign(new Error(envelope?.error?.message ?? `HTTP ${res.status}`), {
      status: res.status,
      body,
      code: envelope?.error?.code,
      traceId: envelope?.error?.traceId,
    });
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
