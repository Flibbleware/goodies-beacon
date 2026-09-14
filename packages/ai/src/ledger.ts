import {
  type AiProvider,
  type AiRole,
  costLedger,
  type Database,
  type Logger,
} from '@goodies-beacon/core';
import { computeCost, PRICES_CHECKED_ON, type Usage } from './pricing.js';

/**
 * Every model call, recorded (§9): what it was for, what it cost, and whether the cost is known.
 *
 * Written after the call rather than before it, because a call that failed cost nothing and a
 * ledger that counted attempts would overstate the month and trip the budget cap early.
 */

export interface LedgerEntry {
  role: AiRole;
  provider: AiProvider;
  model: string;
  usage: Usage;
  wantedItemId?: string | null;
  candidateId?: string | null;
}

/** Warned once per process per model, so a poll of 500 listings logs one line rather than 500. */
const warnedModels = new Set<string>();

export function resetUnknownModelWarnings(): void {
  warnedModels.clear();
}

export async function recordUsage(
  db: Database,
  logger: Logger,
  entry: LedgerEntry,
): Promise<{ costUsd: number; known: boolean }> {
  const { costUsd, known } = computeCost(entry.provider, entry.model, entry.usage);

  if (!known) {
    const id = `${entry.provider}:${entry.model}`;
    if (!warnedModels.has(id)) {
      warnedModels.add(id);
      /**
       * A warning rather than a zero cost quietly recorded: the costs page and the budget cap
       * both read this table, and a model priced at nothing would make the month look free right
       * up until the provider's invoice disagreed.
       */
      logger.warn('no price for this model, so its cost is not counted', {
        model: id,
        pricesCheckedOn: PRICES_CHECKED_ON,
        fix: 'add it to packages/ai/src/pricing.ts',
      });
    }
  }

  await db.insert(costLedger).values({
    role: entry.role,
    provider: entry.provider,
    model: entry.model,
    wantedItemId: entry.wantedItemId ?? null,
    candidateId: entry.candidateId ?? null,
    inputTokens: entry.usage.inputTokens,
    outputTokens: entry.usage.outputTokens,
    cacheReadTokens: entry.usage.cacheReadTokens ?? 0,
    cacheWriteTokens: entry.usage.cacheWriteTokens ?? 0,
    costUsd: costUsd.toFixed(6),
    costKnown: known,
  });

  return { costUsd, known };
}
