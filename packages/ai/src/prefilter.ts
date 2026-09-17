import {
  type Criterion,
  type PrefilterOutput,
  prefilterOutputSchema,
  type WantedSpec,
} from '@goodies-beacon/core';
import {
  CLASSIFIER_TEMPERATURE,
  type GenerateDeps,
  generateForRole,
  ModelOutputError,
} from './generate.js';
import type { Usage } from './pricing.js';
import {
  buildPrefilterPrompt,
  PREFILTER_PROMPT_VERSION,
  PREFILTER_SYSTEM,
} from './prompts/prefilter.v1.js';

/**
 * The text pre-filter (§7 step 3): the cheap pass that stops obvious rubbish reaching the vision
 * model.
 *
 * It runs on every new listing, so the input is bounded rather than whatever the marketplace sent,
 * and it is deliberately reluctant to reject — see the prompt's own changelog for why. The target
 * from §7 is 60–70% of candidates discarded on a targeted query and 90%+ on a broad one, for a
 * few hundredths of a cent each.
 */

/** §7 step 3: "the first ~1,500 characters of description". */
export const DESCRIPTION_LIMIT = 1_500;

/**
 * A title long enough to be a description in disguise. eBay allows 80 characters; a "title" of
 * several hundred is a seller keyword-stuffing, and there is no sense paying to read all of it.
 */
export const TITLE_LIMIT = 200;

/**
 * The ceiling on everything the model emits, which is **not** the same as the length of the
 * answer — and the difference is what made the pre-filter unusable on the model it ships
 * configured to use.
 *
 * This was 200 until P1-17, on the reasoning that "a reason is one short sentence, and nothing
 * here needs more". That is true of the visible output and false of a reasoning model, where
 * hidden reasoning tokens are charged against the same ceiling: `openai:gpt-5-nano` — the default
 * for this role — spent the whole 200 on reasoning, emitted nothing, and failed the schema on
 * *every* call. Measured against the fixture set, it needs about 600 and fails at 800.
 *
 * Because the pre-filter fails open (§7 step 3), none of that surfaced as an error: an instance
 * kept every listing and sent all of them to the reviewer, paying mid-tier prices for the stage
 * that exists to avoid them. P1-17's evaluation found it on its first run against OpenAI; the
 * check had only ever been run against Gemini, which does not reason and answered inside 200.
 *
 * A ceiling rather than a target: a model that does not reason still emits its one sentence and
 * costs the same as it always did.
 */
const MAX_OUTPUT_TOKENS = 2000;

export interface PrefilterListing {
  title: string;
  description?: string | null;
}

export interface PrefilterRequest {
  listing: PrefilterListing;
  /** The item's current spec: its summary, plausibility note and criteria. */
  spec: Pick<WantedSpec, 'summary' | 'plausibilityNote' | 'criteria'>;
  wantedItemId?: string | null;
  candidateId?: string | null;
  abortSignal?: AbortSignal;
}

export interface PrefilterResult extends PrefilterOutput {
  /** Which prompt decided it, recorded so an old decision stays explainable. */
  promptVersion: string;
  costUsd: number;
  /** Null when nothing was asked, which is what `failedOpen` means. */
  modelRef: string | null;
  usage: Usage;
  /**
   * True when no model was consulted and the listing was kept anyway — the model was unreachable,
   * or answered something that would not parse. Distinguishes "a model said keep this" from
   * "nothing could be asked", which reads very differently on a candidate that turns out to be
   * rubbish.
   */
  failedOpen: boolean;
}

/**
 * Cuts the description to the first `DESCRIPTION_LIMIT` characters, at a word boundary where one
 * is near enough, so the model is not handed a word sliced in half.
 */
export function boundDescription(
  description: string | null | undefined,
  limit = DESCRIPTION_LIMIT,
): string | null {
  const text = description?.trim();
  if (!text) return null;
  if (text.length <= limit) return text;

  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour the word boundary if it is close to the limit; a description with no spaces at
  // all — a run of HTML, say — would otherwise be cut back to almost nothing.
  const bounded = lastSpace > limit * 0.8 ? cut.slice(0, lastSpace) : cut;
  return `${bounded.trimEnd()}…`;
}

/** Criterion text only. The pre-filter is told what the reviewer will check, not to check it. */
export function criteriaTitles(criteria: readonly Criterion[]): string[] {
  return criteria.map((criterion) => criterion.text.trim()).filter((text) => text !== '');
}

/**
 * Judge one listing.
 *
 * **Fails open.** A model that cannot be reached, or that answers something the schema rejects,
 * lets the listing through to the reviewer rather than discarding it. The two failures are not
 * symmetrical: a wrongly kept listing costs a fraction of a penny and is caught a moment later,
 * while a wrongly discarded one is never reviewed, never emailed, and never noticed — which is
 * the one outcome this whole product exists to avoid (§1).
 */
export async function runPrefilter(
  deps: GenerateDeps,
  request: PrefilterRequest,
): Promise<PrefilterResult> {
  const prompt = buildPrefilterPrompt({
    specSummary: request.spec.summary,
    plausibilityNote: request.spec.plausibilityNote,
    criteriaTitles: criteriaTitles(request.spec.criteria),
    listingTitle: request.listing.title.slice(0, TITLE_LIMIT),
    listingDescription: boundDescription(request.listing.description),
  });

  try {
    const result = await generateForRole(deps, {
      role: 'prefilter',
      schema: prefilterOutputSchema,
      system: PREFILTER_SYSTEM,
      prompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: CLASSIFIER_TEMPERATURE,
      wantedItemId: request.wantedItemId ?? null,
      candidateId: request.candidateId ?? null,
      ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
    });

    return {
      plausible: result.object.plausible,
      reason: result.object.reason,
      promptVersion: PREFILTER_PROMPT_VERSION,
      costUsd: result.costUsd,
      modelRef: result.modelRef,
      usage: result.usage,
      failedOpen: false,
    };
  } catch (error) {
    // An abort is the process shutting down, not a pre-filter outcome: let it stop the job.
    if (request.abortSignal?.aborted) throw error;

    const because = error instanceof Error ? error.message : String(error);
    deps.logger.warn('pre-filter failed; keeping the listing for review', {
      candidateId: request.candidateId ?? null,
      malformedOutput: error instanceof ModelOutputError,
      error: because,
    });

    return {
      plausible: true,
      reason: 'The pre-filter could not be run, so this was kept for review.',
      promptVersion: PREFILTER_PROMPT_VERSION,
      costUsd: 0,
      modelRef: null,
      usage: { inputTokens: 0, outputTokens: 0 },
      failedOpen: true,
    };
  }
}
