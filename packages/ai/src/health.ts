import type { AiProvider, HealthResult, Settings } from '@goodies-beacon/core';
import { generateText } from 'ai';
import { createModel, ProviderNotConfiguredError } from './providers.js';

/**
 * The Settings "Test" button, per provider (§9).
 *
 * It makes a real call rather than checking that a key is non-empty, for the same reason the eBay
 * test runs the adapter's own health check: what Settings reports should be what a review would
 * hit. The call is the smallest one the provider will accept, so testing a key costs a fraction
 * of a penny.
 */

const PROBE_PROMPT = 'Reply with the single word: ok';
const PROBE_MAX_TOKENS = 16;

export interface ProviderTestDeps {
  settings: Settings;
  secretKey: string;
  env?: Parameters<typeof createModel>[1]['env'];
  /** Which model to probe with. Defaults to the one the reviewer role is set to. */
  model?: string;
  abortSignal?: AbortSignal;
}

/**
 * Probes a provider with the model a role is actually configured to use.
 *
 * Testing a hard-coded model per provider would pass while the configured one 404s — a key can be
 * valid and still have no access to the model someone typed, which is the failure worth catching
 * here rather than in the first review.
 */
export async function testProvider(
  provider: AiProvider,
  deps: ProviderTestDeps,
): Promise<HealthResult> {
  const checkedAt = new Date();
  const ref = deps.model ?? modelForProvider(provider, deps.settings);

  if (!ref) {
    return {
      status: 'error',
      message: `No role is using ${provider}. Point a role at it, or name a model to test.`,
      checkedAt,
    };
  }

  try {
    const role = createModel(ref, {
      settings: deps.settings,
      secretKey: deps.secretKey,
      ...(deps.env ? { env: deps.env } : {}),
    });

    await generateText({
      model: role.languageModel,
      prompt: PROBE_PROMPT,
      maxOutputTokens: PROBE_MAX_TOKENS,
      // One attempt: a Test button should report what happened, not spend three keys' worth
      // of quota hiding an intermittent failure the operator wants to know about.
      maxRetries: 0,
      ...(deps.abortSignal ? { abortSignal: deps.abortSignal } : {}),
    });

    return { status: 'ok', message: `${role.model} answered.`, checkedAt, details: { model: ref } };
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return { status: 'error', message: error.message, checkedAt };
    }

    /**
     * The provider's own words, verbatim, as the SMTP test reports an SMTP error: "model not
     * found" and "insufficient quota" need different fixes, and a message of ours would flatten
     * both into "it did not work".
     */
    return {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      checkedAt,
      details: { model: ref },
    };
  }
}

/** The first role pointed at this provider — the reviewer first, since it is the costly one. */
function modelForProvider(provider: AiProvider, settings: Settings): string | undefined {
  const prefix = `${provider}:`;
  return [settings.ai.roles.reviewer, settings.ai.roles.prefilter, settings.ai.roles.interviewer]
    .filter((ref) => ref.startsWith(prefix))
    .at(0);
}
