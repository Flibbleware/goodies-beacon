import {
  type Criterion,
  type CriterionResultEntry,
  type MediaKind,
  type ReviewerOutput,
  readSettings,
  reviewerOutputSchema,
  type WantedSpec,
} from '@goodies-beacon/core';
import {
  CLASSIFIER_TEMPERATURE,
  type GenerateDeps,
  generateForRole,
  ModelOutputError,
} from './generate.js';
import { buildReviewPrompt, countImages, type LabelledImage } from './images.js';
import { boundDescription } from './prefilter.js';
import type { Usage } from './pricing.js';
import {
  REVIEWER_PROMPT_VERSION,
  REVIEWER_SYSTEM,
  type ReviewerListingInput,
  renderCriteria,
  renderImageIntro,
  renderListing,
  renderSpecSummary,
} from './prompts/reviewer.v1.js';

/**
 * The vision review (§7 step 5): the expensive pass that actually looks at the photographs.
 *
 * It reports per-criterion evidence and nothing else — the decision is P1-11's deterministic
 * function reading these results. Where the pre-filter fails *open*, this stage fails **loud**: a
 * model that cannot be reached or will not hold the schema leaves the candidate in a visible
 * `failed` state for P1-12 to retry, because a review that silently produced nothing is a listing
 * the collector is never told about, and there is no cheap later stage to catch it.
 */

/**
 * The reviewer reads the full description (§7 step 4 has already enriched it), but not without
 * limit: a description is attacker-controlled text that is paid for by the token, and past a few
 * thousand characters a marketplace listing is boilerplate, postage tables and shop policies.
 */
export const REVIEW_DESCRIPTION_LIMIT = 8_000;

/** An image as it goes into the prompt, and as it is recorded against the verdict. */
export interface ReviewImage extends LabelledImage {
  /** The `media` row P1-05 wrote, so "Show prompt" can render the thumbnail (§8). */
  mediaId: string;
}

/** What is stored in `verdicts.prompt_images` — ids and labels, never the bytes. */
export interface PromptImageRef {
  mediaId: string;
  label: string;
  kind: MediaKind;
}

export interface ReviewListing {
  title: string;
  description?: string | null;
  /** Rendered for display, e.g. "£95.00 (listed $120.00)"; the ceiling was applied in step 2. */
  price?: string | null;
  url?: string | null;
  images?: readonly ReviewImage[];
}

export interface ReviewRequest {
  listing: ReviewListing;
  spec: Pick<WantedSpec, 'summary' | 'criteria'>;
  /** The item's reference photographs with their labels, from the spec version (§4). */
  referenceImages?: readonly ReviewImage[];
  /** A grading scale's examples. Empty until Phase 5. */
  gradeImages?: readonly ReviewImage[];
  wantedItemId?: string | null;
  candidateId?: string | null;
  abortSignal?: AbortSignal;
}

export interface ReviewResult extends ReviewerOutput {
  promptVersion: string;
  /** The exact text sent, for the verdict's "Show prompt" (§8). */
  promptText: string;
  promptImages: PromptImageRef[];
  costUsd: number;
  /** False when the model was not in the price table, so the cost is a floor. */
  costKnown: boolean;
  /** Recorded on the verdict as well as the ledger (§4). */
  usage: Usage;
  /** `provider:model`, so a verdict names what judged it. */
  modelRef: string;
}

/**
 * A review that could not be completed.
 *
 * Carries the prompt anyway, so a failed review is as inspectable as a successful one — the
 * question after a failure is almost always "what did we actually send it".
 */
export class ReviewFailedError extends Error {
  override readonly name = 'ReviewFailedError';
  readonly promptText: string;
  readonly promptImages: PromptImageRef[];
  /** True when the model answered but not to the schema, twice. Retrying will not help. */
  readonly malformedOutput: boolean;

  constructor(
    message: string,
    details: {
      cause: unknown;
      promptText: string;
      promptImages: PromptImageRef[];
      malformedOutput: boolean;
    },
  ) {
    super(message, { cause: details.cause });
    this.promptText = details.promptText;
    this.promptImages = details.promptImages;
    this.malformedOutput = details.malformedOutput;
  }
}

/**
 * The ceiling on everything the model emits, reasoning included — which is the part that bites.
 *
 * This took `generate.ts`'s 4096 default until P1-17's evaluation measured it. A thinking model's
 * hidden reasoning is charged against the same allowance as the answer, and `gemini-3.8-flash`
 * spends anywhere between about 1,300 and over 4,000 on one eight-criterion review: the same case
 * ran twice and failed once in three attempts, which is a reviewer that dead-letters a candidate
 * now and then for no reason anybody could see from the outside.
 *
 * Eight thousand is roughly twice the largest run measured. It is a ceiling and not a target, so a
 * model that answers in 1,300 still costs what it did — and a call that fails is billed anyway
 * while producing nothing, so raising it cannot be the more expensive choice.
 */
const MAX_OUTPUT_TOKENS = 8000;

/** The same bounding as the pre-filter's, at the reviewer's larger budget. */
export function boundReviewDescription(
  description: string | null | undefined,
  limit = REVIEW_DESCRIPTION_LIMIT,
): string | null {
  return boundDescription(description, limit);
}

function refs(images: readonly ReviewImage[], kind: MediaKind): PromptImageRef[] {
  return images.map((image) => ({ mediaId: image.mediaId, label: image.label, kind }));
}

/**
 * Lines the model's answers up with the criteria that were actually asked.
 *
 * Zod proves the *shape* of a response, not that it answered the question: a model can return
 * four well-formed results for five criteria, or invent an id. A criterion with no answer becomes
 * `unknown`, which is the safe reading — §7 step 6 surfaces an unknown to the collector or
 * rejects on it, where dropping the criterion would let a silent omission read as a pass and
 * email them something the rules were never given the chance to stop. An unrecognised id is
 * dropped: there is no criterion for the rules to apply it to.
 */
export function reconcileCriteria(
  criteria: readonly Criterion[],
  answered: readonly CriterionResultEntry[],
): { results: CriterionResultEntry[]; missing: string[]; unexpected: string[] } {
  const byId = new Map(answered.map((entry) => [entry.criterionId, entry]));
  const known = new Set(criteria.map((criterion) => criterion.id));

  const missing: string[] = [];
  const results = criteria.map((criterion) => {
    const entry = byId.get(criterion.id);
    if (entry) return entry;

    missing.push(criterion.id);
    return {
      criterionId: criterion.id,
      result: 'unknown' as const,
      evidence: 'The reviewer did not answer this criterion.',
    };
  });

  const unexpected = answered
    .map((entry) => entry.criterionId)
    .filter((id) => !known.has(id))
    .filter((id, index, all) => all.indexOf(id) === index);

  return { results, missing, unexpected };
}

/**
 * Review one listing against one spec version.
 *
 * Throws `ReviewFailedError` rather than returning a verdict it does not have. P1-12 records that
 * as a `failed` candidate with the error visible in the UI and retries it with backoff.
 */
export async function runReviewer(
  deps: GenerateDeps,
  request: ReviewRequest,
): Promise<ReviewResult> {
  // Read here rather than left to `generateForRole`, because the image strategy is read from the
  // same Settings and a second read could disagree with the one the call was billed under.
  const settings = deps.settings ?? (await readSettings(deps.db));
  const referenceImages = request.referenceImages ?? [];
  const gradeImages = request.gradeImages ?? [];
  const listingImages = request.listing.images ?? [];

  const listing: ReviewerListingInput = {
    title: request.listing.title,
    description: boundReviewDescription(request.listing.description),
    price: request.listing.price ?? null,
    url: request.listing.url ?? null,
    imageCount: listingImages.length,
  };

  const promptInput = {
    stable: {
      instructions: '',
      specSummary: renderSpecSummary(request.spec.summary),
      criteria: [
        renderCriteria(request.spec.criteria),
        renderImageIntro(referenceImages.length, gradeImages.length),
      ]
        .filter((section) => section !== '')
        .join('\n\n'),
      referenceImages,
      gradeImages,
    },
    listing: { text: renderListing(listing), images: listingImages },
    strategy: settings.ai.imageStrategy,
  };

  const parts = buildReviewPrompt(promptInput);
  const promptImages = [
    ...refs(referenceImages, 'reference'),
    ...refs(gradeImages, 'grade_example'),
    ...refs(listingImages, 'listing'),
  ];

  // Rebuilt rather than read back from a failed call, so a failure can still show its prompt.
  const promptText = `${REVIEWER_SYSTEM}\n\n${parts
    .map((part) => (part.type === 'text' ? part.text : '[image]'))
    .join('\n')}`;

  try {
    const result = await generateForRole(
      { ...deps, settings },
      {
        role: 'reviewer',
        schema: reviewerOutputSchema,
        system: REVIEWER_SYSTEM,
        prompt: parts,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: CLASSIFIER_TEMPERATURE,
        wantedItemId: request.wantedItemId ?? null,
        candidateId: request.candidateId ?? null,
        ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
      },
    );

    const { results, missing, unexpected } = reconcileCriteria(
      request.spec.criteria,
      result.object.criteriaResults,
    );

    if (missing.length > 0 || unexpected.length > 0) {
      deps.logger.warn('the reviewer did not answer the criteria as asked', {
        candidateId: request.candidateId ?? null,
        model: `${result.role.provider}:${result.role.model}`,
        missing,
        unexpected,
      });
    }

    return {
      criteriaResults: results,
      englishSummary: result.object.englishSummary,
      shipsToUk: result.object.shipsToUk,
      grade: result.object.grade,
      promptVersion: REVIEWER_PROMPT_VERSION,
      promptText: result.promptText,
      promptImages,
      costUsd: result.costUsd,
      costKnown: result.costKnown,
      usage: result.usage,
      modelRef: result.modelRef,
    };
  } catch (error) {
    if (request.abortSignal?.aborted) throw error;

    const malformedOutput = error instanceof ModelOutputError;
    const because = error instanceof Error ? error.message : String(error);

    throw new ReviewFailedError(`the review could not be completed: ${because}`, {
      cause: error,
      promptText,
      promptImages,
      malformedOutput,
    });
  }
}

/** How many images this review would carry, for §7's "images per review" count on the item page. */
export function countReviewImages(request: ReviewRequest): number {
  return countImages({
    stable: {
      instructions: '',
      specSummary: '',
      criteria: '',
      referenceImages: request.referenceImages ?? [],
      gradeImages: request.gradeImages ?? [],
    },
    listing: { text: '', images: request.listing.images ?? [] },
  });
}
