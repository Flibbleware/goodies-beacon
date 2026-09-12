import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIGEST_TIME,
  DEFAULT_TIMEZONE,
  settingsPatchSchema,
  settingsSchema,
} from './settings.js';

describe('settingsSchema', () => {
  it('fills an empty document in with defaults, so a new section needs no migration', () => {
    expect(settingsSchema.parse({})).toEqual({
      instance: { timezone: DEFAULT_TIMEZONE, digestTime: DEFAULT_DIGEST_TIME },
    });
  });

  it('keeps what has been stored', () => {
    const stored = { instance: { timezone: 'Asia/Tokyo', digestTime: '19:30' } };
    expect(settingsSchema.parse(stored)).toEqual(stored);
  });

  it('refuses a time zone that is not an IANA name', () => {
    expect(settingsSchema.safeParse({ instance: { timezone: 'Europe/Atlantis' } }).success).toBe(
      false,
    );
    expect(settingsSchema.safeParse({ instance: { timezone: 'Europe/London' } }).success).toBe(
      true,
    );
  });

  it('refuses anything that is not a 24-hour clock time', () => {
    for (const digestTime of ['8am', '25:00', '08:60', '8:00', '', '08:00:00']) {
      expect(settingsSchema.safeParse({ instance: { digestTime } }).success, digestTime).toBe(
        false,
      );
    }
    for (const digestTime of ['00:00', '08:00', '23:59']) {
      expect(settingsSchema.safeParse({ instance: { digestTime } }).success, digestTime).toBe(true);
    }
  });
});

describe('settingsPatchSchema', () => {
  it('leaves out what was not sent, rather than filling it in with a default', () => {
    const patch = settingsPatchSchema.parse({ instance: { digestTime: '06:15' } });

    // A default here would overwrite a stored timezone with Europe/London on every save.
    expect(patch.instance).toEqual({ digestTime: '06:15' });
    expect(patch.instance).not.toHaveProperty('timezone');
  });

  it('accepts an empty patch and a patch with no sections', () => {
    expect(settingsPatchSchema.parse({})).toEqual({});
    expect(settingsPatchSchema.parse({ instance: {} })).toEqual({ instance: {} });
  });

  it('validates the fields it is given as strictly as a full save', () => {
    expect(settingsPatchSchema.safeParse({ instance: { timezone: 'nowhere' } }).success).toBe(
      false,
    );
    expect(settingsPatchSchema.safeParse({ instance: { digestTime: '99:99' } }).success).toBe(
      false,
    );
  });
});
