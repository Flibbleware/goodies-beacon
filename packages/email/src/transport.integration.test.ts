import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testMessage } from './test-message.js';
import { SmtpError, type SmtpSettings, sendMail } from './transport.js';

/**
 * Against Mailpit, which is what development uses (P0-11 puts it in `compose.dev.yml`). Set
 * `TEST_SMTP_URL` to its SMTP address — `smtp://localhost:1025` — and `TEST_MAILPIT_URL` to its
 * HTTP API, so a send can be checked by reading the inbox rather than trusting the return.
 */
const smtpUrl = process.env.TEST_SMTP_URL;
const mailpitUrl = process.env.TEST_MAILPIT_URL ?? 'http://localhost:8025';

const TO = 'owner@example.com';

function settings(overrides: Partial<SmtpSettings> = {}): SmtpSettings {
  const url = new URL(smtpUrl ?? 'smtp://localhost:1025');
  return {
    host: url.hostname,
    port: Number(url.port),
    security: 'none',
    username: '',
    password: '',
    fromAddress: 'beacon@example.com',
    ...overrides,
  };
}

async function inbox(): Promise<{ To: { Address: string }[]; Subject: string }[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/messages`);
  const body = (await res.json()) as { messages: { To: { Address: string }[]; Subject: string }[] };
  return body.messages;
}

describe.skipIf(!smtpUrl)('sendMail against Mailpit', () => {
  beforeEach(async () => {
    await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
  });

  afterEach(async () => {
    await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
  });

  it('delivers the test message, and the inbox has it', async () => {
    await sendMail(settings(), { ...testMessage('beacon.example.co.uk'), to: TO });

    const messages = await inbox();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.Subject).toBe('Goodies Beacon test email');
    expect(messages[0]?.To.map((entry) => entry.Address)).toEqual([TO]);
  });

  it('names the instance in the body, so it is obvious which one sent it', async () => {
    await sendMail(settings(), { ...testMessage('beacon.example.co.uk'), to: TO });

    const [message] = await inbox();
    const res = await fetch(`${mailpitUrl}/api/v1/message/${(message as { ID: string }).ID}`);
    const body = (await res.json()) as { Text: string };

    expect(body.Text).toContain('beacon.example.co.uk');
  });

  it('reports a refused connection rather than hanging or swallowing it', async () => {
    // Port 1 on loopback refuses immediately, which is what a wrong port looks like.
    const error = await sendMail(settings({ port: 1 }), {
      ...testMessage('beacon.example.co.uk'),
      to: TO,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(SmtpError);
    expect((error as SmtpError).detail).toMatch(/ECONNREFUSED|connect/i);
  });

  it('reports that TLS was demanded and not offered, in the words it was told', async () => {
    // Mailpit here has no TLS, so requireTLS cannot be satisfied.
    const error = await sendMail(settings({ security: 'starttls' }), {
      ...testMessage('beacon.example.co.uk'),
      to: TO,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(SmtpError);
    expect((error as SmtpError).detail.length).toBeGreaterThan(0);
    expect(await inbox()).toEqual([]);
  });
});
