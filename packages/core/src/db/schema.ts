import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  AI_ROLES,
  BUYING_TYPES,
  CANDIDATE_ORIGINS,
  CANDIDATE_STAGES,
  FEEDBACK_RESOLUTIONS,
  FEEDBACK_TYPES,
  MEDIA_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_MODES,
  REJECTION_REASONS,
  SHIPS_TO_UK,
  SPEC_ORIGINS,
  VERDICT_DECISIONS,
  WANTED_ITEM_STATUSES,
} from '../domain/constants.js';
import { SOURCE_IDS } from '../sources.js';

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Builds `column in ('a','b')` so a check constraint and its TypeScript union share one source.
 *
 * The values are inlined rather than bound: this ends up inside `CREATE TABLE`, and DDL takes no
 * parameters — a `sql`${value}`` here yields `in ($1, $2)` and Postgres rejects it at migration
 * time. They are quote-escaped even though every current value is a bare identifier, because the
 * next one added should not have to remember.
 */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ');
  return sql`${column} in (${sql.raw(list)})`;
}

/**
 * One row holding the whole instance configuration as JSONB. Secrets inside `data` are
 * stored as `enc:v1:<ciphertext>` (see crypto.ts); the check constraint is what makes the
 * singleton real rather than a convention.
 */
export const settings = pgTable(
  'settings',
  {
    id: smallint('id').primaryKey().default(1),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [check('settings_is_singleton', sql`${table.id} = 1`)],
);

/** The single user (§12). Absent until the first-run password is set in P0-07. */
export const authUser = pgTable(
  'auth_user',
  {
    id: smallint('id').primaryKey().default(1),
    passwordHash: text('password_hash').notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [check('auth_user_is_singleton', sql`${table.id} = 1`)],
);

export const authSession = pgTable(
  'auth_session',
  {
    /** SHA-256 of the 256-bit token the cookie carries, so a copy of this table opens nothing. */
    id: text('id').primaryKey(),
    userId: smallint('user_id')
      .notNull()
      .references(() => authUser.id, { onDelete: 'cascade' }),
    createdAt,
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('auth_session_expires_at_idx').on(table.expiresAt)],
);

/**
 * Liveness per process role, written by the `heartbeat.<role>` job every five minutes (§P0-06).
 * One row per role rather than per process: what the dashboard asks is whether an API and a worker
 * are answering, not how many of each there are.
 */
export const processHeartbeat = pgTable('process_heartbeat', {
  role: text('role').primaryKey(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The per-instance salt for `listings.seller_hash`, stored as `enc:v1:<ciphertext>` under
 * GOODIES_BEACON_SECRET_KEY like every other secret (§12).
 *
 * It is a row rather than a value derived from the master key so that rotating that key — the
 * documented remedy if it leaks — re-wraps this one row instead of silently orphaning every
 * hash already written and breaking relist detection with no error to notice. Encrypting it
 * means a stolen database alone does not let anyone hash a list of usernames and match them.
 */
export const instanceSecret = pgTable(
  'instance_secret',
  {
    id: smallint('id').primaryKey().default(1),
    sellerSalt: text('seller_salt').notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [check('instance_secret_is_singleton', sql`${table.id} = 1`)],
);

export const wantedItems = pgTable(
  'wanted_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    status: text('status')
      .$type<(typeof WANTED_ITEM_STATUSES)[number]>()
      .notNull()
      .default('draft'),
    notificationMode: text('notification_mode')
      .$type<(typeof NOTIFICATION_MODES)[number]>()
      .notNull()
      .default('digest'),
    /**
     * ISO 8601 duration (PT8H); null means "use the global default" (§4).
     *
     * §4 wrote this as a Postgres interval. It holds the same vocabulary the spec settings use
     * instead, because the two are edited as one field in the UI and a value that parsed one way
     * in JSONB and another in a column is a bug waiting for whoever writes the second editor.
     */
    pollEvery: text('poll_every'),
    gradingScaleId: uuid('grading_scale_id').references(() => gradingScales.id, {
      onDelete: 'set null',
    }),
    minimumGrade: text('minimum_grade'),
    /** Nullable because version 1 is written after the item; the pair is circular by nature. */
    currentSpecVersionId: uuid('current_spec_version_id').references(
      (): AnyPgColumn => specVersions.id,
      { onDelete: 'set null' },
    ),
    createdAt,
    updatedAt,
  },
  (table) => [
    check('wanted_items_status', oneOf(table.status, WANTED_ITEM_STATUSES)),
    check('wanted_items_notification_mode', oneOf(table.notificationMode, NOTIFICATION_MODES)),
    index('wanted_items_status_idx').on(table.status),
  ],
);

/**
 * Immutable. Every change — a chat amendment, a direct edit, adding an image — writes a new row,
 * and a verdict records which one judged it, so "why did it reject this in July" stays answerable
 * (§4). The four JSONB columns are validated at the boundary by the P1-02 schemas.
 */
export const specVersions = pgTable(
  'spec_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wantedItemId: uuid('wanted_item_id')
      .notNull()
      .references(() => wantedItems.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    createdBy: text('created_by').$type<(typeof SPEC_ORIGINS)[number]>().notNull(),
    summary: text('summary').notNull().default(''),
    /** A per-item note the interviewer writes for the pre-filter prompt (§7 step 3). */
    plausibilityNote: text('plausibility_note'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
    criteria: jsonb('criteria').$type<unknown[]>().notNull().default([]),
    searchPlans: jsonb('search_plans').$type<unknown[]>().notNull().default([]),
    referenceImages: jsonb('reference_images').$type<unknown[]>().notNull().default([]),
    changeNote: text('change_note'),
    createdAt,
  },
  (table) => [
    check('spec_versions_created_by', oneOf(table.createdBy, SPEC_ORIGINS)),
    check('spec_versions_version_positive', sql`${table.version} > 0`),
    uniqueIndex('spec_versions_item_version_key').on(table.wantedItemId, table.version),
  ],
);

/**
 * Per search plan, keyed on the plan id inside `spec_versions.search_plans`. Plan ids are stable
 * across versions when the plan is unchanged (§4), so this survives an amendment — which is the
 * point: the watermark must not reset because a criterion was reworded.
 */
export const searchPlanState = pgTable(
  'search_plan_state',
  {
    planId: text('plan_id').primaryKey(),
    wantedItemId: uuid('wanted_item_id')
      .notNull()
      .references(() => wantedItems.id, { onDelete: 'cascade' }),
    source: text('source').$type<(typeof SOURCE_IDS)[number]>().notNull(),
    /** Newest listing actually processed. Never advanced past what was handled (§6). */
    watermark: timestamp('watermark', { withTimezone: true }),
    /**
     * The older window a poll that hit the cap still owes, or null when it owes none.
     *
     * Sources page newest-first, so a run that stops at the cap takes the newest N and leaves
     * everything between the old watermark and that batch unreached. The watermark still advances
     * — those newest N really were processed — and this records what was skipped, so the next run
     * searches [backlogFrom..backlogUntil) instead of the fresh window and walks the gap backwards
     * until it is empty. Without it the next run would fetch the same newest N again and the gap
     * would never be reached at all (§6).
     */
    backlogFrom: timestamp('backlog_from', { withTimezone: true }),
    backlogUntil: timestamp('backlog_until', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    candidatesFound: integer('candidates_found').notNull().default(0),
    candidatesReviewed: integer('candidates_reviewed').notNull().default(0),
    candidatesMatched: integer('candidates_matched').notNull().default(0),
    candidatesUncertain: integer('candidates_uncertain').notNull().default(0),
    prefilterCostUsd: numeric('prefilter_cost_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    createdAt,
    updatedAt,
  },
  (table) => [
    check('search_plan_state_source', oneOf(table.source, SOURCE_IDS)),
    index('search_plan_state_item_idx').on(table.wantedItemId),
  ],
);

/** Stub until Phase 5; the column on `wanted_items` needs something to point at. */
export const gradingScales = pgTable('grading_scales', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  category: text('category'),
  grades: jsonb('grades').$type<unknown[]>().notNull().default([]),
  createdAt,
  updatedAt,
});

/**
 * One row per (source, externalId).
 *
 * `seller_hash` is the only trace of who listed it, and there is deliberately no column that
 * could hold a name: see ARCHITECTURE.md §4. The adapter also strips the whole seller object out
 * of `raw` before it gets here — eBay returns a business seller's legal name and street address
 * in it (found by S1-01).
 */
export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').$type<(typeof SOURCE_IDS)[number]>().notNull(),
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    titleEn: text('title_en'),
    description: text('description'),
    descriptionEn: text('description_en'),
    /** Normalised: an eBay auction reports `null` price and its value in `currentBidPrice` (S1-01). */
    priceAmount: numeric('price_amount', { precision: 12, scale: 2 }),
    priceCurrency: text('price_currency'),
    priceGbp: numeric('price_gbp', { precision: 12, scale: 2 }),
    /** Which day's ECB rate produced `price_gbp`, so an old conversion stays explainable (P1-06). */
    priceRateDate: text('price_rate_date'),
    buyingType: text('buying_type').$type<(typeof BUYING_TYPES)[number]>(),
    sellerHash: text('seller_hash'),
    itemLocationCountry: text('item_location_country'),
    shipsToUk: text('ships_to_uk')
      .$type<(typeof SHIPS_TO_UK)[number]>()
      .notNull()
      .default('unknown'),
    images: jsonb('images').$type<unknown[]>().notNull().default([]),
    listedAt: timestamp('listed_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    createdAt,
    updatedAt,
  },
  (table) => [
    check('listings_source', oneOf(table.source, SOURCE_IDS)),
    check('listings_ships_to_uk', oneOf(table.shipsToUk, SHIPS_TO_UK)),
    check(
      'listings_buying_type',
      sql`${table.buyingType} is null or ${oneOf(table.buyingType, BUYING_TYPES)}`,
    ),
    uniqueIndex('listings_source_external_id_key').on(table.source, table.externalId),
    index('listings_first_seen_at_idx').on(table.firstSeenAt),
  ],
);

/**
 * Never pruned (§4). Retention deletes candidates and the listings behind them, so without this a
 * still-live fixed-price listing would look new again on the next poll and be emailed twice.
 */
export const seen = pgTable(
  'seen',
  {
    source: text('source').$type<(typeof SOURCE_IDS)[number]>().notNull(),
    externalId: text('external_id').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.source, table.externalId] }),
    check('seen_source', oneOf(table.source, SOURCE_IDS)),
  ],
);

export const candidates = pgTable(
  'candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    wantedItemId: uuid('wanted_item_id')
      .notNull()
      .references(() => wantedItems.id, { onDelete: 'cascade' }),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    specVersionId: uuid('spec_version_id')
      .notNull()
      .references(() => specVersions.id, { onDelete: 'restrict' }),
    /**
     * Which plan surfaced it, so P1-14's per-plan stats are computable. Nullable because a scan
     * or a backfill need not come from a plan. Not in §4's field list; the stats require it.
     */
    searchPlanId: text('search_plan_id'),
    origin: text('origin').$type<(typeof CANDIDATE_ORIGINS)[number]>().notNull().default('poll'),
    stage: text('stage').$type<(typeof CANDIDATE_STAGES)[number]>().notNull().default('new'),
    /** Set when `stage` is 'failed', so P1-12's failure is visible without opening a log. */
    error: text('error'),
    retain: boolean('retain').notNull().default(false),
    relistOf: uuid('relist_of').references((): AnyPgColumn => candidates.id, {
      onDelete: 'set null',
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    check('candidates_origin', oneOf(table.origin, CANDIDATE_ORIGINS)),
    check('candidates_stage', oneOf(table.stage, CANDIDATE_STAGES)),
    uniqueIndex('candidates_item_listing_key').on(table.wantedItemId, table.listingId),
    index('candidates_item_created_idx').on(table.wantedItemId, table.createdAt),
    index('candidates_item_stage_idx').on(table.wantedItemId, table.stage),
    index('candidates_plan_idx').on(table.searchPlanId),
  ],
);

/**
 * Re-reviews append; the newest row for a candidate is authoritative (§4).
 *
 * A hard-filter rejection (§7 step 2) also writes one, with `reason` set and the model columns
 * null — that is what keeps "rejected, and here is why" in the audit view without pretending the
 * reviewer was consulted.
 */
export const verdicts = pgTable(
  'verdicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    specVersionId: uuid('spec_version_id')
      .notNull()
      .references(() => specVersions.id, { onDelete: 'restrict' }),
    decision: text('decision').$type<(typeof VERDICT_DECISIONS)[number]>().notNull(),
    reason: text('reason').$type<(typeof REJECTION_REASONS)[number]>(),
    criteriaResults: jsonb('criteria_results').$type<unknown[]>().notNull().default([]),
    grade: text('grade'),
    englishSummary: text('english_summary'),
    modelRole: text('model_role').$type<(typeof AI_ROLES)[number]>(),
    model: text('model'),
    /** The exact prompt and image list sent, so "Show prompt" is a read rather than a rebuild. */
    promptText: text('prompt_text'),
    promptImages: jsonb('prompt_images').$type<unknown[]>(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }),
    createdAt,
  },
  (table) => [
    check('verdicts_decision', oneOf(table.decision, VERDICT_DECISIONS)),
    check(
      'verdicts_reason',
      sql`${table.reason} is null or ${oneOf(table.reason, REJECTION_REASONS)}`,
    ),
    check(
      'verdicts_model_role',
      sql`${table.modelRole} is null or ${oneOf(table.modelRole, AI_ROLES)}`,
    ),
    // The UI asks for "this item's candidates, filtered by verdict" (P1-15); the filter lands
    // here, on the newest verdict per candidate, rather than being denormalised onto candidates.
    index('verdicts_candidate_created_idx').on(table.candidateId, table.createdAt),
    index('verdicts_decision_idx').on(table.decision),
  ],
);

/** Stub until Phase 5, but retained forever once written (§4), so it is here from the start. */
export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    verdictId: uuid('verdict_id').references(() => verdicts.id, { onDelete: 'set null' }),
    type: text('type').$type<(typeof FEEDBACK_TYPES)[number]>().notNull(),
    note: text('note'),
    resolution: text('resolution').$type<(typeof FEEDBACK_RESOLUTIONS)[number]>(),
    createdAt,
  },
  (table) => [
    check('feedback_type', oneOf(table.type, FEEDBACK_TYPES)),
    check(
      'feedback_resolution',
      sql`${table.resolution} is null or ${oneOf(table.resolution, FEEDBACK_RESOLUTIONS)}`,
    ),
    index('feedback_candidate_idx').on(table.candidateId),
  ],
);

/** The unique index is the at-most-once guarantee §10 relies on, not a convention. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => candidates.id, { onDelete: 'cascade' }),
    channel: text('channel').$type<(typeof NOTIFICATION_CHANNELS)[number]>().notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    digestDate: text('digest_date'),
    createdAt,
  },
  (table) => [
    check('notifications_channel', oneOf(table.channel, NOTIFICATION_CHANNELS)),
    uniqueIndex('notifications_candidate_channel_key').on(table.candidateId, table.channel),
  ],
);

/** Per-call AI usage, for the costs page and the monthly budget guardrail (§9). */
export const costLedger = pgTable(
  'cost_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    role: text('role').$type<(typeof AI_ROLES)[number]>().notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    wantedItemId: uuid('wanted_item_id').references(() => wantedItems.id, { onDelete: 'set null' }),
    candidateId: uuid('candidate_id').references(() => candidates.id, { onDelete: 'set null' }),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    createdAt,
  },
  (table) => [
    check('cost_ledger_role', oneOf(table.role, AI_ROLES)),
    // The budget cap sums a calendar month, and the costs page groups by item (§9).
    index('cost_ledger_created_idx').on(table.createdAt),
    index('cost_ledger_item_idx').on(table.wantedItemId),
  ],
);

/**
 * Downscaled images on the media volume (P1-05). `contentHash` is the dedupe key — the same photo
 * fetched twice is stored once — and `perceptualHash` is what relist detection compares (§7).
 */
export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').$type<(typeof MEDIA_KINDS)[number]>().notNull(),
    path: text('path').notNull(),
    thumbnailPath: text('thumbnail_path'),
    contentHash: text('content_hash').notNull(),
    perceptualHash: text('perceptual_hash'),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** Shown beside a reference image so the reviewer knows which variant it is (§8). */
    label: text('label'),
    sourceUrl: text('source_url'),
    createdAt,
  },
  (table) => [
    check('media_kind', oneOf(table.kind, MEDIA_KINDS)),
    uniqueIndex('media_content_hash_key').on(table.contentHash),
  ],
);

/**
 * Cookies that outlive the process, keyed by source and domain (§5).
 *
 * In the database rather than in memory because Vinted's DataDome cookie is the whole point:
 * losing it on every restart means re-solving the challenge, and re-solving it repeatedly is what
 * gets a worker blocked. One row per cookie so a single expiry does not discard the rest.
 */
export const sourceCookies = pgTable(
  'source_cookies',
  {
    source: text('source').$type<(typeof SOURCE_IDS)[number]>().notNull(),
    domain: text('domain').notNull(),
    name: text('name').notNull(),
    value: text('value').notNull(),
    path: text('path').notNull().default('/'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.source, table.domain, table.name] }),
    check('source_cookies_source', oneOf(table.source, SOURCE_IDS)),
  ],
);

/**
 * Daily reference rates, one row per currency per publication date (§4 price conversion).
 *
 * Stored as units per GBP, because every conversion in Goodies Beacon goes *to* GBP: a price of
 * 40 USD is `40 / units_per_gbp('USD')`. Rows are kept rather than overwritten so a verdict from
 * July can still be explained — `listings.price_rate_date` names the row that was used, and the
 * ECB publishes on working days only, so that date is often not the day the listing was seen.
 */
export const fxRates = pgTable(
  'fx_rates',
  {
    currency: text('currency').notNull(),
    /** The ECB publication date, as `YYYY-MM-DD`; not the day we fetched it. */
    rateDate: text('rate_date').notNull(),
    unitsPerGbp: numeric('units_per_gbp', { precision: 18, scale: 8 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.currency, table.rateDate] }),
    index('fx_rates_currency_date_idx').on(table.currency, table.rateDate),
  ],
);

export type InstanceSecret = typeof instanceSecret.$inferSelect;
export type FxRate = typeof fxRates.$inferSelect;
export type SourceCookie = typeof sourceCookies.$inferSelect;
export type WantedItem = typeof wantedItems.$inferSelect;
export type NewWantedItem = typeof wantedItems.$inferInsert;
export type SpecVersion = typeof specVersions.$inferSelect;
export type NewSpecVersion = typeof specVersions.$inferInsert;
export type SearchPlanState = typeof searchPlanState.$inferSelect;
export type GradingScale = typeof gradingScales.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;
export type Seen = typeof seen.$inferSelect;
export type Candidate = typeof candidates.$inferSelect;
export type NewCandidate = typeof candidates.$inferInsert;
export type Verdict = typeof verdicts.$inferSelect;
export type NewVerdict = typeof verdicts.$inferInsert;
export type Feedback = typeof feedback.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type CostLedgerEntry = typeof costLedger.$inferSelect;
export type Media = typeof media.$inferSelect;
export type NewMedia = typeof media.$inferInsert;

export type SettingsRow = typeof settings.$inferSelect;
export type AuthUser = typeof authUser.$inferSelect;
export type AuthSession = typeof authSession.$inferSelect;
export type ProcessHeartbeat = typeof processHeartbeat.$inferSelect;
