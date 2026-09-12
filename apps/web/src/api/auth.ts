import type { QueryClient } from '@tanstack/react-query';
import { api } from './client.js';

export interface SessionState {
  authenticated: boolean;
  /** No password has been set yet, so the first thing to do is choose one. */
  firstRun: boolean;
}

export const sessionQuery = {
  queryKey: ['session'] as const,
  queryFn: () => api<SessionState>('/api/auth/session'),
  // Whether we are signed in is the one thing never served from a cache: the cookie can expire
  // or be revoked between navigations, and only the server knows.
  staleTime: 0,
  retry: false,
} as const;

export function login(password: string): Promise<{ authenticated: true }> {
  return api('/api/auth/login', { method: 'POST', body: { password } });
}

export function setFirstPassword(password: string): Promise<{ authenticated: true }> {
  return api('/api/auth/first-run', { method: 'POST', body: { password } });
}

export function logout(): Promise<void> {
  return api('/api/auth/logout', { method: 'POST' });
}

/**
 * The session as the router sees it. `fetchQuery` rather than `ensureQueryData`, which answers
 * from the cache whenever it holds anything at all — so a guard using it would send a visitor who
 * had just signed in straight back to the login page on the stale "not authenticated" it read a
 * moment earlier. One request per guarded navigation is the price of the guard being right.
 */
export function loadSession(queryClient: QueryClient): Promise<SessionState> {
  return queryClient.fetchQuery(sessionQuery);
}
