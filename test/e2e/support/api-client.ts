/**
 * Thin API client for E2E test helpers.
 *
 * Wraps fetch to talk directly to the API in test assertions, allowing
 * independent verification that a UI action produced the correct server state.
 */

import { API_BASE_URL } from '../playwright.config';

export class ApiClient {
  constructor(
    private readonly baseUrl: string = API_BASE_URL,
    private readonly authToken?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) h['Authorization'] = `Bearer ${this.authToken}`;
    return h;
  }

  withToken(token: string): ApiClient {
    return new ApiClient(this.baseUrl, token);
  }

  async get<T = unknown>(path: string): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    const body = res.status !== 204 ? await res.json() as T : {} as T;
    return { status: res.status, body };
  }

  async post<T = unknown>(path: string, payload?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const body = res.status !== 204 ? await res.json() as T : {} as T;
    return { status: res.status, body };
  }

  async patch<T = unknown>(path: string, payload?: unknown): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const body = res.status !== 204 ? await res.json() as T : {} as T;
    return { status: res.status, body };
  }
}

/** Create a staff API client authenticated for a given tenant. */
export async function createStaffApiClient(
  baseUrl: string,
  credentials: { email: string; password: string },
): Promise<ApiClient> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
  const { accessToken } = await res.json() as { accessToken: string };
  return new ApiClient(baseUrl, accessToken);
}
