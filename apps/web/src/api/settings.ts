import type { PublicSettings, SettingsPatch } from '@goodies-beacon/core/schemas';
import { api } from './client.js';

export interface SettingsResponse {
  settings: PublicSettings;
  /** GOODIES_BEACON_HOST, shown read-only: it comes from the environment, not from settings. */
  instanceHost: string;
}

export const settingsQuery = {
  queryKey: ['settings'] as const,
  queryFn: () => api<SettingsResponse>('/api/settings'),
} as const;

export function saveSettings(patch: SettingsPatch): Promise<SettingsResponse> {
  return api<SettingsResponse>('/api/settings', { method: 'PUT', body: patch });
}

export function sendTestEmail(): Promise<{ sentTo: string }> {
  return api('/api/settings/email/test', { method: 'POST' });
}

export function changePassword(currentPassword: string, newPassword: string): Promise<unknown> {
  return api('/api/auth/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
}
