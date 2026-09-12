import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIGEST_TIME,
  DEFAULT_SMTP_PORT,
  DEFAULT_TIMEZONE,
  isEmailConfigured,
  settingsPatchSchema,
  settingsSchema,
  toPublicSettings,
} from './schema.js';

describe('settingsSchema', () => {
  it('fills an empty document in with defaults, so a new section needs no migration', () => {
    expect(settingsSchema.parse({})).toEqual({
      instance: { timezone: DEFAULT_TIMEZONE, digestTime: DEFAULT_DIGEST_TIME },
      email: {
        host: '',
        port: DEFAULT_SMTP_PORT,
        security: 'starttls',
        username: '',
        password: '',
        fromAddress: '',
        notificationAddress: '',
      },
    });
  });

  it('keeps what has been stored', () => {
    const parsed = settingsSchema.parse({
      instance: { timezone: 'Asia/Tokyo', digestTime: '19:30' },
    });
    expect(parsed.instance).toEqual({ timezone: 'Asia/Tokyo', digestTime: '19:30' });
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

describe('emailSettingsSchema', () => {
  it('accepts an instance where nothing has been configured yet', () => {
    expect(settingsSchema.safeParse({ email: {} }).success).toBe(true);
  });

  it('refuses an address that is not one, but allows it to be left empty', () => {
    for (const field of ['fromAddress', 'notificationAddress']) {
      expect(settingsSchema.safeParse({ email: { [field]: '' } }).success, field).toBe(true);
      expect(
        settingsSchema.safeParse({ email: { [field]: 'not-an-address' } }).success,
        field,
      ).toBe(false);
      expect(
        settingsSchema.safeParse({ email: { [field]: 'me@example.com' } }).success,
        field,
      ).toBe(true);
    }
  });

  it('refuses a port outside the range, and reads one sent as a string', () => {
    expect(settingsSchema.parse({ email: { port: '2525' } }).email.port).toBe(2525);
    for (const port of [0, 65536, 1.5, 'smtp']) {
      expect(settingsSchema.safeParse({ email: { port } }).success, String(port)).toBe(false);
    }
  });

  it('refuses a security mode it does not know how to configure', () => {
    expect(settingsSchema.safeParse({ email: { security: 'ssl' } }).success).toBe(false);
    expect(settingsSchema.safeParse({ email: { security: 'starttls' } }).success).toBe(true);
  });
});

describe('toPublicSettings', () => {
  const configured = settingsSchema.parse({
    email: {
      host: 'smtp.example.com',
      password: 'enc:v1:Y2lwaGVydGV4dA==',
      fromAddress: 'beacon@example.com',
      notificationAddress: 'owner@example.com',
    },
  });

  it('replaces the SMTP password with whether there is one', () => {
    const email = toPublicSettings(configured).email;

    expect(email).not.toHaveProperty('password');
    expect(email.passwordSet).toBe(true);
    expect(JSON.stringify(email)).not.toContain('enc:v1:');
  });

  it('says there is no password when none has been set', () => {
    expect(toPublicSettings(settingsSchema.parse({})).email.passwordSet).toBe(false);
  });

  it('leaves the instance section as it is', () => {
    expect(toPublicSettings(configured).instance).toEqual(configured.instance);
  });
});

describe('isEmailConfigured', () => {
  const base = { host: '', fromAddress: '', notificationAddress: '' };

  it('needs a host, a from address and a notification address', () => {
    expect(isEmailConfigured({ ...base } as never)).toBe(false);
    expect(isEmailConfigured({ ...base, host: 'smtp.example.com' } as never)).toBe(false);
    expect(
      isEmailConfigured({
        host: 'smtp.example.com',
        fromAddress: 'beacon@example.com',
        notificationAddress: 'owner@example.com',
      } as never),
    ).toBe(true);
  });

  it('does not require a password, since a relay may want none', () => {
    expect(
      isEmailConfigured({
        host: 'smtp.example.com',
        fromAddress: 'beacon@example.com',
        notificationAddress: 'owner@example.com',
        passwordSet: false,
      } as never),
    ).toBe(true);
  });
});
