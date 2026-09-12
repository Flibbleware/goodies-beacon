/** The error shape every endpoint answers with (see docs/API.md). */
export interface ApiErrorBody {
  error: { code: string; message: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const CSRF_COOKIE = 'gb_csrf';
const CSRF_HEADER = 'X-CSRF-Token';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Same-origin fetch against the API: in production the API serves this app, and in development
 * Vite proxies `/api` to it, so a relative URL is right either way.
 *
 * The CSRF token is read from the cookie the API sets and sent back in the header it expects
 * (§12 double-submit). Any safe request mints the cookie, and the session query is the first
 * thing the app does, so by the time anything is saved the token is there.
 */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const headers = new Headers({ Accept: 'application/json' });

  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  if (UNSAFE.has(method)) {
    const token = readCookie(CSRF_COOKIE);
    if (token) headers.set(CSRF_HEADER, token);
  }

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

  if (res.status === 204) return undefined as T;

  const payload = await res.json().catch(() => undefined);

  if (!res.ok) {
    const body = payload as ApiErrorBody | undefined;
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'unknown',
      body?.error?.message ?? `Request failed with status ${res.status}.`,
    );
  }

  return payload as T;
}

function readCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
