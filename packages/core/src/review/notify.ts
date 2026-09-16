import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { notifications } from '../db/schema.js';
import type { CriterionResultEntry } from '../domain/verdict.js';
import type { Logger } from '../logger.js';
import type { NotificationMessage, ReviewPorts } from './ports.js';

/**
 * The one notification Phase 1 sends (§10, and P1-12's own scope note).
 *
 * Deliberately minimal: a plain-text email for a `match` or `uncertain` on a real-time item that
 * came from a poll. No template, no digest, no batching of backfill results — those are the
 * notifications phase. It is here because the transport already exists and an email is the
 * product's actual output; without it the reviewer's work is only visible to someone refreshing
 * a tab.
 */

export interface NotifyInput {
  candidateId: string;
  itemTitle: string;
  decision: 'match' | 'uncertain';
  listingTitle: string;
  priceGbp: string | null;
  listingUrl: string;
  candidateUrl: string;
  englishSummary: string;
  criteria: readonly { id: string; text: string }[];
  criteriaResults: readonly CriterionResultEntry[];
}

/** The email body. Plain text, because §10's templates are Phase 3 and this has to be readable. */
export function notificationMessage(input: NotifyInput): NotificationMessage {
  const unknowns = input.criteriaResults.filter((entry) => entry.result === 'unknown');
  const failures = input.criteriaResults.filter((entry) => entry.result === 'fail');
  const textFor = (criterionId: string) =>
    input.criteria.find((criterion) => criterion.id === criterionId)?.text ?? criterionId;

  const lines = [
    input.decision === 'match'
      ? `A listing matches "${input.itemTitle}".`
      : `A listing for "${input.itemTitle}" needs your eye.`,
    '',
    input.listingTitle,
    input.priceGbp ? `£${input.priceGbp}` : 'Price not given',
    '',
    input.englishSummary,
  ];

  /**
   * §10: an uncertain email says exactly what was unknown ("manuals not shown or mentioned"). The
   * whole value of the uncertain verdict is that the gap is named, so this is not optional garnish.
   */
  if (unknowns.length > 0) {
    lines.push('', 'Could not be established:');
    for (const entry of unknowns) {
      lines.push(`  - ${textFor(entry.criterionId)} — ${entry.evidence}`);
    }
  }

  if (failures.length > 0) {
    lines.push('', 'Did not pass:');
    for (const entry of failures) {
      lines.push(`  - ${textFor(entry.criterionId)} — ${entry.evidence}`);
    }
  }

  lines.push('', `Listing:   ${input.listingUrl}`, `Candidate: ${input.candidateUrl}`);

  return {
    subject:
      input.decision === 'match'
        ? `Match: ${input.listingTitle}`
        : `Possible match: ${input.listingTitle}`,
    text: lines.join('\n'),
  };
}

export interface NotifyDeps {
  db: Database;
  logger: Logger;
  sendEmail?: ReviewPorts['sendEmail'];
}

/**
 * Sends at most one real-time email per candidate, ever.
 *
 * **The row is written before the email is sent, not after.** The unique index on
 * `(candidate_id, channel)` is the at-most-once guarantee (§10), and it only holds if claiming the
 * row is what decides whether to send: writing it afterwards would let a job that crashed between
 * sending and recording send again on its retry. The cost of this order is that a crash between
 * the claim and the send loses that one email, which is the right way round — a missed email is
 * visible in the UI, where a duplicate is just noise that teaches the owner to ignore them.
 */
export async function notifyRealtime(deps: NotifyDeps, input: NotifyInput): Promise<boolean> {
  const claimed = await deps.db
    .insert(notifications)
    .values({ candidateId: input.candidateId, channel: 'realtime' })
    .onConflictDoNothing({ target: [notifications.candidateId, notifications.channel] })
    .returning({ id: notifications.id });

  const row = claimed[0];
  if (!row) {
    deps.logger.debug('candidate already notified; not sending again', {
      candidateId: input.candidateId,
    });
    return false;
  }

  if (!deps.sendEmail) {
    /**
     * The claim stands rather than being rolled back. An instance with no SMTP configured would
     * otherwise re-attempt this candidate on every retry for ever, and the verdict is visible in
     * the UI regardless — which is where someone who has not set up mail is looking anyway.
     */
    deps.logger.warn('no SMTP configured; the match was recorded but no email was sent', {
      candidateId: input.candidateId,
    });
    return false;
  }

  await deps.sendEmail(notificationMessage(input));

  // After the send, never before: a row claiming `sentAt` for an email that then failed would
  // read as delivered for ever. A row with `sentAt` null is "claimed but never delivered", which
  // is the one state worth being able to find afterwards.
  await deps.db
    .update(notifications)
    .set({ sentAt: sql`now()` })
    .where(eq(notifications.id, row.id));

  deps.logger.info('sent a real-time notification', {
    candidateId: input.candidateId,
    decision: input.decision,
  });
  return true;
}
