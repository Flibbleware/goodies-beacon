/**
 * @goodies-beacon/email — the SMTP transport and the notification templates.
 *
 * Templates for real-time and digest emails arrive in Phase 3; the transport and the Settings
 * test send are here from P0-10.
 */
export const EMAIL_CHANNELS = ['realtime', 'digest'] as const;
export type EmailChannel = (typeof EMAIL_CHANNELS)[number];

export { testMessage } from './test-message.js';
export { type Message, SmtpError, type SmtpSettings, sendMail } from './transport.js';
