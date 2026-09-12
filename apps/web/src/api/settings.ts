import { api } from './client.js';

export interface InstanceSettings {
  timezone: string;
  digestTime: string;
}

export interface SettingsResponse {
  settings: { instance: InstanceSettings };
  /** GOODIES_BEACON_HOST, shown read-only: it comes from the environment, not from settings. */
  instanceHost: string;
}

export type SettingsPatch = { instance?: Partial<InstanceSettings> };

export const settingsQuery = {
  queryKey: ['settings'] as const,
  queryFn: () => api<SettingsResponse>('/api/settings'),
} as const;

export function saveSettings(patch: SettingsPatch): Promise<SettingsResponse> {
  return api<SettingsResponse>('/api/settings', { method: 'PUT', body: patch });
}
