import { createTransport } from 'nodemailer';

/** What the transport needs, already decrypted by the caller. */
export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly security: 'none' | 'starttls' | 'tls';
  readonly username: string;
  readonly password: string;
  readonly fromAddress: string;
}

export interface Message {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

/**
 * Carries what the SMTP server actually said. `message` is Nodemailer's summary and `response`
 * the server's own reply; the UI shows the reply when there is one, because "550 5.7.1 Relaying
 * denied" tells the owner what to fix and "Message failed" does not.
 */
export class SmtpError extends Error {
  override readonly name = 'SmtpError';

  constructor(
    message: string,
    readonly response: string | undefined,
    readonly code: string | undefined,
  ) {
    super(message);
  }

  /** The most specific thing the server or the library said, for showing verbatim. */
  get detail(): string {
    return this.response ?? this.message;
  }
}

export async function sendMail(smtp: SmtpSettings, message: Message): Promise<void> {
  const transport = createTransport({
    host: smtp.host,
    port: smtp.port,
    // Nodemailer's `secure` means implicit TLS on connect; STARTTLS is an upgrade afterwards,
    // which it does by itself when the server offers it unless told not to.
    secure: smtp.security === 'tls',
    ...(smtp.security === 'none' ? { ignoreTLS: true } : {}),
    ...(smtp.security === 'starttls' ? { requireTLS: true } : {}),
    ...(smtp.username === '' ? {} : { auth: { user: smtp.username, pass: smtp.password } }),
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });

  try {
    await transport.sendMail({
      from: smtp.fromAddress,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html === undefined ? {} : { html: message.html }),
    });
  } catch (error) {
    throw asSmtpError(error);
  } finally {
    transport.close();
  }
}

function asSmtpError(error: unknown): SmtpError {
  if (!(error instanceof Error)) return new SmtpError(String(error), undefined, undefined);

  const { response, code } = error as { response?: unknown; code?: unknown };
  return new SmtpError(
    error.message,
    typeof response === 'string' ? response.trim() : undefined,
    typeof code === 'string' ? code : undefined,
  );
}
