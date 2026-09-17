/**
 * @goodies-beacon/ai — every model call in Goodies Beacon goes through here (§9).
 *
 * The shape of the package is the point: a caller names a *role* and a Zod schema, and never a
 * provider. Which model answers is a Settings change, the cost of answering is recorded against
 * the item and the candidate, and a month's spend is capped. Prompts themselves belong to the
 * tasks that own them — the pre-filter's in P1-09, the reviewer's in P1-10.
 */

/** Re-exported so a caller needs one import; the values themselves are core's (§4). */
export { AI_ROLES, type AiRole } from '@goodies-beacon/core';
export {
  assertWithinBudget,
  type BudgetDeps,
  BudgetExceededError,
  type BudgetState,
  budgetPeriod,
  checkBudget,
  monthStart,
  nextMonthStart,
  recordBudgetExceeded,
  withBudgetGuard,
} from './budget.js';
export {
  assertBudget,
  BudgetSpentError,
  type Confusion,
  EMPTY,
  type EvalRun,
  markdownSummary,
  type Score,
  score,
  tally,
} from './eval/score.js';
export {
  type GenerateDeps,
  type GenerateRequest,
  type GenerateResult,
  generateForRole,
  ModelOutputError,
  OBJECT_RETRIES,
} from './generate.js';
export { type ProviderTestDeps, testProvider } from './health.js';
export {
  buildReviewPrompt,
  countImages,
  type LabelledImage,
  type PromptPart,
  RemoteImageError,
  type ReviewPromptInput,
  UnsupportedStrategyError,
} from './images.js';
export {
  type LedgerEntry,
  recordUsage,
  resetUnknownModelWarnings,
} from './ledger.js';
export {
  boundDescription,
  criteriaTitles,
  DESCRIPTION_LIMIT,
  type PrefilterListing,
  type PrefilterRequest,
  type PrefilterResult,
  runPrefilter,
  TITLE_LIMIT,
} from './prefilter.js';
export {
  type CostResult,
  computeCost,
  findPrice,
  type ModelPrice,
  PRICES,
  PRICES_CHECKED_ON,
  type Usage,
} from './pricing.js';
export {
  buildPrefilterPrompt,
  PREFILTER_PROMPT_VERSION,
  PREFILTER_SYSTEM,
  type PrefilterPromptInput,
} from './prompts/prefilter.v1.js';
export {
  REVIEWER_PROMPT_VERSION,
  REVIEWER_SYSTEM,
  type ReviewerListingInput,
  renderCriteria,
  renderImageIntro,
  renderListing,
  renderSpecSummary,
} from './prompts/reviewer.v1.js';
export {
  createModel,
  modelForRole,
  normaliseOllamaUrl,
  type ProviderDeps,
  ProviderNotConfiguredError,
  type ResolvedRole,
  UnknownModelRefError,
} from './providers.js';
export {
  boundReviewDescription,
  countReviewImages,
  type PromptImageRef,
  REVIEW_DESCRIPTION_LIMIT,
  ReviewFailedError,
  type ReviewImage,
  type ReviewListing,
  type ReviewRequest,
  type ReviewResult,
  reconcileCriteria,
  runReviewer,
} from './reviewer.js';
export { splitUsage } from './usage.js';
