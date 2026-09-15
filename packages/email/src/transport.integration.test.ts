import { randomUUID } from 'node:crypto';
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

/**
 * Vitest's default is five seconds, which is a unit-test budget. These talk to a real SMTP server
 * over a real socket, and on a loaded run — the browser tests drive Chromium, the database tests
 * run serially — a send has overrun it. When it did, the message landed *after* the test's own
 * cleanup and failed the next test on an inbox it had not filled, so one slow send read as two
 * bugs, neither of them real.
 */
const NETWORK_TIMEOUT_MS = 30_000;

/** Each test sends to its own address, so a late arrival cannot be mistaken for another's. */
function recipient(): string {
  return `owner+${randomUUID()}@example.com`;
}

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

interface InboxMessage {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}

async function inbox(): Promise<InboxMessage[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/messages`);
  const body = (await res.json()) as { messages: InboxMessage[] };
  return body.messages;
}

const addressedTo = (messages: InboxMessage[], address: string): InboxMessage[] =>
  messages.filter((message) => message.To.some((entry) => entry.Address === address));

/**
 * Waits for a message rather than reading once. `sendMail` resolves when the server has accepted
 * the message, which is a moment before Mailpit has indexed it and made it visible over HTTP.
 */
async function waitForMessage(address: string): Promise<InboxMessage> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [message] = addressedTo(await inbox(), address);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no message for ${address} arrived within five seconds`);
}

describe.skipIf(!smtpUrl)('sendMail against Mailpit', () => {
  /**
   * The inbox is still emptied around each test so a failure leaves nothing behind, but nothing
   * asserts on it being empty: each test looks only at its own recipient, so a message arriving
   * late cannot be read as another test's bug.
   */
  beforeEach(async () => {
    await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
  });

  afterEach(async () => {
    await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
  });

  it(
    'delivers the test message, and the inbox has it',
    async () => {
      const to = recipient();
      await sendMail(settings(), { ...testMessage('beacon.example.co.uk'), to });

      const message = await waitForMessage(to);

      expect(message.Subject).toBe('Goodies Beacon test email');
      expect(message.To.map((entry) => entry.Address)).toEqual([to]);
    },
    NETWORK_TIMEOUT_MS,
  );

  it(
    'names the instance in the body, so it is obvious which one sent it',
    async () => {
      const to = recipient();
      await sendMail(settings(), { ...testMessage('beacon.example.co.uk'), to });

      const message = await waitForMessage(to);
      const res = await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`);
      const body = (await res.json()) as { Text: string };

      expect(body.Text).toContain('beacon.example.co.uk');
    },
    NETWORK_TIMEOUT_MS,
  );

  it(
    'reports a refused connection rather than hanging or swallowing it',
    async () => {
      // Port 1 on loopback refuses immediately, which is what a wrong port looks like.
      const error = await sendMail(settings({ port: 1 }), {
        ...testMessage('beacon.example.co.uk'),
        to: recipient(),
      }).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(SmtpError);
      expect((error as SmtpError).detail).toMatch(/ECONNREFUSED|connect/i);
    },
    NETWORK_TIMEOUT_MS,
  );

  it(
    'reports that TLS was demanded and not offered, in the words it was told',
    async () => {
      // Mailpit here has no TLS, so requireTLS cannot be satisfied.
      const to = recipient();
      const error = await sendMail(settings({ security: 'starttls' }), {
        ...testMessage('beacon.example.co.uk'),
        to,
      }).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(SmtpError);
      expect((error as SmtpError).detail.length).toBeGreaterThan(0);
      // Scoped to this test's own recipient. Asserting the whole inbox was empty made this fail
      // whenever an earlier test's message landed after that test's cleanup.
      expect(addressedTo(await inbox(), to)).toEqual([]);
    },
    NETWORK_TIMEOUT_MS,
  );
});
