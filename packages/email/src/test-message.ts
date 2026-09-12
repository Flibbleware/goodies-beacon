import type { Message } from './transport.js';

/**
 * The message the Settings page sends to prove the SMTP settings work. Deliberately plain: if
 * this arrives, the credentials, the from address and the notification address are all right,
 * and nothing about it depends on a template that Phase 3 has not written yet.
 */
export function testMessage(instanceHost: string): Omit<Message, 'to'> {
  return {
    subject: 'Goodies Beacon test email',
    text: [
      'This is a test email from Goodies Beacon.',
      '',
      'If you are reading it, the SMTP settings on your instance work and notifications',
      'about matching listings will reach you here.',
      '',
      `Instance: ${instanceHost}`,
    ].join('\n'),
  };
}
