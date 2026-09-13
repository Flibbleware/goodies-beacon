import { z } from 'zod';
import { SOURCE_IDS } from '../sources.js';
import {
  BACKFILL_DEPTHS,
  BUYING_TYPES,
  CONDITION_CATEGORIES,
  CRITERION_KINDS,
  NOTIFICATION_MODES,
  ON_UNKNOWN,
  RELIST_POLICIES,
  SHIPS_TO_UK_POLICIES,
  SPEC_ORIGINS,
} from './constants.js';

/**
 * The wanted spec, as ARCHITECTURE.md §4 defines it.
 *
 * The settings/criteria split is the load-bearing idea and the schemas enforce it: `settings`
 * holds everything with a bounded set of values and renders as toggles and dropdowns, while
 * `criteria` holds only judgement calls that need reading the description or looking at the
 * photos. The interviewer's `propose_spec` tool is typed to this, so it *cannot* express "under
 * £150" or "UK only" as a criterion — and `lintSpec` catches the cases a human typing into the
 * P1-13 editor still can.
 */

/** ISO 8601 duration, as a poll interval: PT8H, P1D. Null means the global default (§4). */
const DURATION = /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?!$)(\d+H)?(\d+M)?(\d+S)?)?$/;

export const durationSchema = z
  .string()
  .regex(DURATION, 'must be an ISO 8601 duration such as PT8H or P1D');

export const priceCeilingSchema = z.object({
  amount: z.number().positive('must be more than zero'),
  /** GBP only: §4 converts every source's price to GBP before comparing. */
  currency: z.literal('GBP'),
});

export const backfillSchema = z.object({
  enabled: z.boolean().default(false),
  depth: z.enum(BACKFILL_DEPTHS).default('top_200'),
});

export const specSettingsSchema = z.object({
  /** An on/off switch per marketplace; the region lives on the search plan, not here (§4). */
  sources: z.array(z.enum(SOURCE_IDS)).default([]),
  listingTypes: z
    .array(z.enum(BUYING_TYPES))
    .min(1, 'at least one listing type must be allowed')
    .default([...BUYING_TYPES]),
  priceCeiling: priceCeilingSchema.nullable().default(null),
  shipsToUk: z.enum(SHIPS_TO_UK_POLICIES).default('show_all'),
  conditionCategory: z.enum(CONDITION_CATEGORIES).default('any'),
  gradingScaleId: z.uuid().nullable().default(null),
  minimumGrade: z.string().nullable().default(null),
  negativeKeywords: z.array(z.string().min(1)).default([]),
  notificationMode: z.enum(NOTIFICATION_MODES).default('digest'),
  pollEvery: durationSchema.nullable().default(null),
  relists: z.enum(RELIST_POLICIES).default('show'),
  defaultOnUnknown: z.enum(ON_UNKNOWN).default('surface'),
  backfill: backfillSchema.default({ enabled: false, depth: 'top_200' }),
});

export const criterionSchema = z.object({
  /** Stable across versions when the criterion is unchanged, so feedback stays attached (§4). */
  id: z.string().min(1),
  text: z.string().min(1, 'a criterion needs text'),
  kind: z.enum(CRITERION_KINDS),
  /** Can photos or text settle it definitively? Drives the unknown handling in §7 step 6. */
  quantifiable: z.boolean(),
  onUnknown: z.enum(ON_UNKNOWN).default('surface'),
});

export const searchPlanSchema = z.object({
  id: z.string().min(1),
  source: z.enum(SOURCE_IDS),
  query: z.string().min(1, 'a search plan needs a query'),
  /**
   * Where to search, in the source's own vocabulary: an eBay marketplace id (`EBAY_GB`), a
   * Vinted domain (`vinted.co.uk`), or `jp` for the Japanese sources (§4).
   */
  region: z.string().min(1, 'a search plan needs a region'),
  options: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
  watermark: z.coerce.date().nullable().default(null),
});

export const referenceImageSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  /** Shown to the reviewer, so it knows which variant the photo is of (§7 step 5). */
  label: z.string().default(''),
  addedAt: z.coerce.date(),
});

export const wantedSpecSchema = z.object({
  summary: z.string().default(''),
  /**
   * Written for the pre-filter prompt (§7 step 3): "sellers often omit the model number; all-in-one
   * Performa and Power Mac 5xxx listings are plausible".
   */
  plausibilityNote: z.string().nullable().default(null),
  settings: specSettingsSchema,
  criteria: z.array(criterionSchema).default([]),
  searchPlans: z.array(searchPlanSchema).default([]),
  referenceImages: z.array(referenceImageSchema).default([]),
  createdBy: z.enum(SPEC_ORIGINS).default('manual_edit'),
  changeNote: z.string().nullable().default(null),
});

export type PriceCeiling = z.infer<typeof priceCeilingSchema>;
export type SpecSettings = z.infer<typeof specSettingsSchema>;
export type Criterion = z.infer<typeof criterionSchema>;
export type SearchPlan = z.infer<typeof searchPlanSchema>;
export type ReferenceImage = z.infer<typeof referenceImageSchema>;
export type WantedSpec = z.infer<typeof wantedSpecSchema>;
