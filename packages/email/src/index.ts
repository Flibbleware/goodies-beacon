/**
 * @goodies-beacon/email — notification templates and SMTP transport.
 *
 * P0-01 scaffold. SMTP settings and the test send arrive in P0-10; templates in Phase 3.
 */
export const EMAIL_CHANNELS = ['realtime', 'digest'] as const;
export type EmailChannel = (typeof EMAIL_CHANNELS)[number];
