const TOKEN_KEY = 'video-maker-admin-token';

export function getAdminToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setAdminToken(token: string): void {
  if (token.trim()) localStorage.setItem(TOKEN_KEY, token.trim());
  else localStorage.removeItem(TOKEN_KEY);
}

export function adminFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const t = getAdminToken();
  if (t) headers.set('Authorization', `Bearer ${t}`);
  return fetch(input, { ...init, headers });
}

/** Long-running pipeline calls (sync server). */
export const PIPELINE_FETCH_INIT: RequestInit = {
  signal: AbortSignal.timeout(45 * 60 * 1000),
};
