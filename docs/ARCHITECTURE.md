# Goodies Beacon — Architecture Plan

*A self-hosted beacon for the goodies you are hunting: it watches the marketplaces so you do not have to.*

Version 1.19 — 13 September 2026. Written from the agreed requirements; this is the reference for the development plan that follows.

---

## 1. What we are building

Goodies Beacon is a self-hosted, open-source "wanted list" for collectors. You describe an item to an AI interviewer, which asks questions until the criteria are unambiguous and then freezes an agreed **wanted spec** (text criteria, search queries, price ceiling, reference images). Goodies Beacon polls marketplaces on a schedule, an AI reviewer inspects every new listing (title, description, photos) against the spec, and you get an email for real matches — immediately, or in an 8am digest. Anything the reviewer cannot decide is surfaced, not hidden. Everything the reviewer rejected is visible in the web UI so you can audit it, challenge it, and have your challenge folded back into the spec.

It is single-user, runs from one `docker compose up`, and every marketplace and AI credential is supplied by whoever runs the instance.

### Agreed requirements (condensed)

| Area | Decision |
|---|---|
| Sources, v1 | eBay (any marketplace, chosen per search plan), Vinted (UK, EU domains if practical, chosen per plan), Yahoo! Auctions JP, Mercari JP. Which sources an item uses, and in which regions, is configured per item. Facebook Marketplace and Gumtree deferred. |
| Shipping | Do **not** filter out listings that don't ship to the UK; show "ships to UK: yes / no / unknown". |
| Listing types | Auction and fixed price both; notify on first sight, no ending-soon reminders. |
| Price | Optional per-item ceiling in GBP with conversion from USD/EUR/JPY; "any price" allowed. |
| Language | Anything shown to you is in English; Japanese listings get an English summary. |
| Notifications | Per item: real-time email or daily digest. Digest at 08:00 Europe/London covering the previous 24h. Delivery over generic SMTP. |
| Uncertainty | Quantifiable criteria (visible damage vs "no damage") are hard pass/fail. Non-quantifiable evidence ("manuals not shown, not mentioned") is surfaced as *uncertain* rather than rejected. Per-criterion behaviour can be hardened later. |
| Grading | User-defined grading scales (e.g. poor → mint for big-box PC games, with example images) attached to a category and applied to a wanted item manually. |
| Relists | Show again in v1, with a "seen before" flag; suppression is a later toggle. |
| Feedback | "Not a match" / "Challenge rejection" with a note → immediate re-review with the note as context → offer to fold the note into the spec permanently. |
| Spec creation | Chat interview inside the web app. Reference image from upload, from early search results, or from web image search. Amend at any time in plain English. |
| Polling | Configurable; default 3×/day, per-item override. |
| Existing listings | Optional one-off backfill of what is listed right now when an item is agreed, plus an on-demand "Scan current listings" button. Results go to the item page and one summary email, never real-time emails. |
| Images | Reference images (labelled variants) and grading example images can be added at any time; each addition creates a new spec version. |
| Transparency | The agreed spec is structured data, rendered in full and editable directly; every verdict shows per-criterion evidence and the exact prompt sent. |
| Settings vs criteria | Anything with a bounded set of values is a typed field on the item; free-text criteria are reserved for judgement calls that need reading or looking. |
| Searching | Search broad, judge narrow. An item holds many search plans across sources (e.g. "macintosh", "mac performa", "power macintosh" on eBay GB and US, plus Japanese keywords on Yahoo/Mercari); queries are editable at any time and each shows its own stats. The reviewer does the narrowing. |
| Retention | Candidates auto-deleted after 30 days unless marked *retain*. |
| Hosting | Docker Compose on a VPS or home machine; the scraping worker can run on a different machine from the core. |
| AI | Provider-swappable by config. Target ≈ $30–50/month. |
| Auth | Single user, password protected. |
| Stack | TypeScript end to end. |

---

## 2. Source feasibility

This is the part that decides how reliable Goodies Beacon is, so it is stated plainly. "Spike" means a throwaway script in Phase 1 that confirms the finding from both a VPS and a home connection before we build the real adapter.

| Source | Access method | Reliability | Datacenter (VPS) IP | Notes |
|---|---|---|---|---|
| **eBay** | Official Browse API (`item_summary/search`, `item/{id}`), application token via client-credentials. | High — supported, versioned, documented. | Fine. | Marketplace chosen per request with the `X-EBAY-C-MARKETPLACE-ID` header (`EBAY_GB`, `EBAY_US`, `EBAY_DE`…). `sort=newlyListed`, filters for `buyingOptions`, `itemLocationCountry`, `price`, `conditions`, `itemStartDate`. Search returns title, price, thumbnail + `additionalImages`, location, `itemCreationDate`; `getItem` returns the full HTML description and full-size images. Default quota is thousands of calls per day — far more than we need. A production keyset is self-service; **spike confirms no extra approval is needed for Browse**. |
| **Vinted** | No public API. The site's own JSON catalog endpoint, called with a session cookie obtained from the homepage. Playwright as fallback. | Medium. Protected by DataDome (TLS fingerprinting + behaviour scoring). | **Effectively blocked.** DataDome flags AWS/GCP/Hetzner-style ranges within the first requests regardless of rate. | Works from residential IPs at low rates with a persisted DataDome cookie. Each country domain (`vinted.co.uk`, `vinted.fr`, `vinted.de`…) is a separate backend and session, so EU coverage is a list of domains in config, not extra code — it just multiplies request volume. Spike also checks whether `vinted.co.uk` already surfaces EU sellers shipping to the UK, which would make extra domains unnecessary. |
| **Yahoo! Auctions JP** | HTML search page (`auctions.yahoo.co.jp/search/search?p=…&s1=new&o1=d`) + item page for description and images. | Medium-high. Plain HTML, light bot protection at low rates. | Fine in practice. | No login needed for search. Item descriptions are Japanese; the reviewer model reads them natively and writes the English summary, so no separate translation service. |
| **Mercari JP** | The site's internal search API (`api.mercari.jp` `entities:search`), which requires a per-request DPoP-signed JWT — a well-known technique used by every existing Mercari scraper. | Medium. Works today; Mercari can change the signing scheme. | Fine in practice. | Isolated in one adapter so a break is a one-file fix. |
| Facebook Marketplace | Logged-in browser session only; hostile to automation; risks the account. | Low. | Blocked. | Deferred. If added later, it runs only as a home worker using a dedicated Facebook account. |
| Gumtree | HTML scraping, no login. | Medium. | Probably fine. | Deferred; cheap to add once the adapter contract exists. |

**The VPS question, answered directly.** eBay, Yahoo Auctions and Mercari are fine from a VPS. Vinted is not: DataDome's decision is driven by *where the request comes from* (datacenter IP ranges, TLS fingerprint), not primarily by how often you ask, so even twice a day from a VPS will be blocked. From a home connection at 2–3 polls per day with a reused session cookie it should be fine. Because the worker is a separate container that only needs a database connection, you can run the core on the VPS and the Vinted worker at home (over Tailscale, see §11), or run everything at home. A third option is a residential proxy for the Vinted worker only, which is a single URL in Settings (see §5) and costs well under £1 a month at Goodies Beacon's traffic. The design supports all three; the Phase 1 spike tests Vinted from the VPS with and without a proxy so the choice is made on evidence.

**Legal note for the README.** Scraping personal-use, low-volume, public listing pages is common practice but may contravene a site's terms of service. Goodies Beacon ships with conservative default rates, never bypasses logins, and each user runs it under their own accounts and responsibility.

---

## 3. System overview

```
                         ┌──────────────────────────────────────────────────┐
                         │                    Web UI (React)                │
                         │  Wanted items · Interview chat · Candidates &    │
                         │  verdicts · Grading scales · Settings · Costs    │
                         └───────────────────────┬──────────────────────────┘
                                                 │ HTTPS (Caddy, auto-TLS)
                         ┌───────────────────────▼──────────────────────────┐
                         │                 API (Node, Hono)                 │
                         │  auth · REST/JSON · SSE for chat streaming ·     │
                         │  interviewer agent · enqueues jobs               │
                         └───────────────────────┬──────────────────────────┘
                                                 │
                    ┌────────────────────────────▼─────────────────────────┐
                    │              PostgreSQL  (data + pg-boss queues)       │
                    └───┬────────────────────────────────────────────┬──────┘
                        │                                            │
        ┌───────────────▼────────────────┐          ┌────────────────▼─────────────────┐
        │  Worker: sources               │          │  Worker: review                  │
        │  runs SourceAdapters on        │  new     │  dedupe → hard filters →         │
        │  schedule; normalises listings │ ───────► │  text pre-filter → enrich →      │
        │  (can run on another machine)  │ listings │  vision review → verdict         │
        └───────────────┬────────────────┘          └────────────────┬─────────────────┘
                        │                                            │
                 eBay API · Vinted ·                         ┌───────▼────────┐
                 Yahoo JP · Mercari JP                       │ Notifier       │
                                                             │ real-time +    │
                                                             │ 08:00 digest   │
                                                             │ via SMTP       │
                                                             └────────────────┘
```

One Docker image, three roles selected by `ROLE=api|worker|all`. Small installs run `all` in one container; the split exists so the sources worker can live on a residential connection.

Components:

**API** — Hono on Node. Serves the built React app, JSON endpoints, and Server-Sent Events for the interview chat. Owns the interviewer agent because it is conversational and user-facing. Enqueues polling and review jobs.

**Sources worker** — Runs each `SourceAdapter` on its schedule, converts results to a normalised `Listing`, inserts new ones, and enqueues review jobs. Contains Playwright for the adapters that need a browser.

**Review worker** — Runs the matching pipeline (§7) and writes `Verdict`s. Calls the AI provider. Enqueues notifications.

**Notifier** — Sends real-time emails and the 08:00 digest. Part of the review worker process; separated logically.

**PostgreSQL** — All state, plus job queues via `pg-boss` (so no Redis). Photos are stored on a Docker volume, downscaled, referenced by path.

**Caddy** — Reverse proxy with automatic HTTPS, for a public hostname or a Tailscale name alike. Not optional: the session cookie is `Secure` (§12), so a browser reached over plain HTTP discards it and nobody can sign in.

---

## 4. Domain model

Names below are the tables/entities; types are illustrative.

**WantedItem** — `id, title, status (draft|active|paused|found|archived), notificationMode (realtime|digest), pollEvery (interval, nullable → global default), gradingScaleId?, minimumGrade?, currentSpecVersionId, createdAt`.

**WantedSpecVersion** — Immutable. `id, wantedItemId, version, createdBy (interview|amendment|challenge|manual_edit|image_added), summary, settings, criteria[], searchPlans[], referenceImages[], changeNote`. Every change — a chat amendment, a direct edit in the form, or adding an image — creates a new version; a verdict records which version judged it, so "why did it reject this in July" is always answerable, and any two versions can be diffed in the UI.

The **settings vs criteria rule.** `settings` holds everything with a bounded set of values and is rendered as toggles, dropdowns and number fields; `criteria` holds only judgement calls that require reading the description or looking at the photos. The interviewer's `propose_spec` tool is typed to this split, so it cannot express "under £150" or "UK only" as a criterion, and a small linter flags criteria that mention prices, countries or listing types.

```ts
type SpecSettings = {
  sources: SourceId[];                          // on/off switch per marketplace for this item;
                                                // region is chosen per search plan (see below)
  listingTypes: ('auction' | 'fixed')[];
  priceCeiling: { amount: number; currency: 'GBP' } | null;
  shipsToUk: 'show_all' | 'flag' | 'only';     // v1 default 'show_all' with the flag shown
  conditionCategory: 'any' | 'new' | 'used' | 'for_parts';   // mapped to source filters where they exist
  gradingScaleId: string | null; minimumGrade: string | null;
  negativeKeywords: string[];
  notificationMode: 'realtime' | 'digest';
  pollEvery: Duration | null;                   // null = global default
  relists: 'show' | 'suppress';                 // v1 default 'show'
  defaultOnUnknown: 'surface' | 'reject';       // per-criterion override still allowed
  backfill: { enabled: boolean; depth: 'top_50' | 'top_200' | 'last_30_days' };
};

type ReferenceImage = { id: string; path: string; label: string; addedAt: Date };
```

```ts
type Criterion = {
  id: string;                 // stable across versions when unchanged
  text: string;               // "Big box (not jewel case) release"
  kind: 'hard' | 'soft';      // hard fail → reject; soft fail → uncertain
  quantifiable: boolean;      // can photos/text settle it definitively?
  onUnknown: 'surface' | 'reject';  // default 'surface' (requirement 8/9)
};

type SearchPlan = {
  id: string;
  source: 'ebay' | 'vinted' | 'yahoo_auctions_jp' | 'mercari_jp';
  query: string;              // "carmageddon", "mac performa", "カーマゲドン"
  region: string;             // where to search, in the source's own terms (below)
  options: Record<string, unknown>; // other adapter-specific filters: category, condition, item-location country
  enabled: boolean;           // pause a query without deleting it
  watermark: Date | null;     // newest listing actually processed; never skips ahead
};
```

**Region lives on the search plan, and nowhere else.** A plan is "this query, on this source, in this region", so the region is a field of the plan in the source's own vocabulary: for eBay a marketplace id (`EBAY_GB`, `EBAY_US`, `EBAY_DE`…, one plan per marketplace), for Vinted a domain (`vinted.co.uk`, `vinted.fr`), for Yahoo! Auctions and Mercari a fixed `jp`. The item-level `settings.sources` list is only an on/off switch per marketplace, so pausing Vinted for an item disables its Vinted plans without deleting them. This makes every combination a plain list of rows in the plan table: "only eBay" is plans that are all eBay; "only eBay UK" is one plan on `EBAY_GB`; "eBay UK + eBay US + Vinted France" is three plans. eBay's `itemLocationCountry` filter ("sellers located in the UK", which is a different thing from "the UK eBay site") is an `options` entry on the plan, off by default because the reviewer reports ships-to-UK anyway. The interviewer asks "which marketplaces and regions?" once and writes the plans; the adapter's `describeSearchOptions()` tells the UI and the interviewer which regions and options each source supports.

**Search broad, judge narrow.** A wanted item deliberately carries several loose queries rather than one precise one, because sellers title things inconsistently ("Carmageddon big box", "Carmageddon Mac OS CD-ROM", "vintage apple computer" with no model number at all). The interviewer proposes queries with this in mind — broad head terms, variants for the ways sellers omit model numbers, Japanese keywords for the Japanese sources, and optionally an eBay category-only plan — and the pre-filter and reviewer do the narrowing. The plan list is a plain editable table on the item page: add, edit, pause or delete a query at any time without touching the criteria. Each plan records its own stats (candidates found, reached vision review, matched, uncertain, pre-filter cost) so you can see whether "mac performa" is earning its keep.

**GradingScale** — `id, name, category ("Big box PC game"), grades[]` where each grade is `{ label, rank, description, exampleImages[] }`. Attached to a WantedItem manually. Example images can be added or removed at any time from the scale page; scales are versioned the same way as specs so a verdict can name the grade images it saw.

**Listing** — One row per (source, externalId). `id, source, externalId, url, title, titleEn?, description, descriptionEn?, priceAmount, priceCurrency, priceGbp, buyingType (auction|fixed), sellerId, sellerName, itemLocationCountry, shipsToUk (yes|no|unknown), images[], listedAt, firstSeenAt, lastSeenAt, raw (jsonb)`.

**Seen** — `(source, externalId, firstSeenAt)`. Never pruned. Prevents an old fixed-price listing from being re-notified after its Listing row is retained-then-deleted.

**Candidate** — Links a Listing to a WantedItem. `id, wantedItemId, listingId, specVersionId, origin (poll|backfill|scan), stage (new|prefiltered|enriched|reviewed), retain (bool), relistOf? (candidateId), createdAt`. Pruned after 30 days unless `retain`. `origin` decides notification routing (§10).

**Verdict** — `id, candidateId, specVersionId, decision (match|uncertain|reject), criteriaResults[] {criterionId, result: pass|fail|unknown, evidence}, grade?, englishSummary, modelRole, model, inputTokens, outputTokens, costUsd, createdAt`. Re-reviews append a new Verdict; the latest is authoritative.

**Feedback** — `id, candidateId, verdictId, type (not_a_match|challenge), note, resolution (rereviewed|folded_into_spec|dismissed), createdAt`. Retained forever; recent feedback for an item is fed to the reviewer as examples.

**Notification** — `id, candidateId, channel (realtime|digest), sentAt, digestDate?`. Guarantees at-most-once per candidate per channel.

**InterviewSession / Message** — The chat transcript for creating or amending a spec.

**Settings** — Single row: global poll interval, digest time + timezone, currency base, retention days, AI role config, per-source credentials (see §12 on secrets).

**CostLedger** — Per-call AI usage, for the costs page and the monthly budget guardrail.

---

## 5. Source adapter contract

Every marketplace is a package under `packages/sources/<name>` implementing one interface. This is the extension point for other people's instances and contributions.

```ts
export interface SourceAdapter {
  readonly id: SourceId;
  readonly displayName: string;
  readonly requiresBrowser: boolean;          // Playwright needed?
  readonly recommendedMinInterval: Duration;  // e.g. 8h for Vinted, 1h for eBay
  readonly credentialSchema: ZodSchema;       // what the user must configure

  /** Validate credentials / session; used by the Settings "Test" button. */
  healthCheck(ctx: AdapterContext): Promise<HealthResult>;

  /** Turn a plain-English wanted spec into source-specific search options.
   *  Called by the interviewer via tool-use so the agent can propose
   *  sensible queries (e.g. Japanese keywords for Yahoo/Mercari). */
  describeSearchOptions(): SearchOptionSchema;

  /** Return listings newer than `since` for this plan. Must be idempotent. */
  search(plan: SearchPlan, since: Date | null, ctx: AdapterContext): Promise<RawListing[]>;

  /** Fetch full description + all images for a listing (only called for
   *  candidates that survive the text pre-filter). */
  enrich(listing: RawListing, ctx: AdapterContext): Promise<EnrichedListing>;
}
```

`AdapterContext` supplies credentials, a rate-limited HTTP client with per-source concurrency and jittered delays, a Playwright browser factory, a cookie jar persisted in the DB (Vinted's DataDome cookie survives restarts), and a logger. Adapters never talk to the database directly.

Per-source notes for the v1 adapters:

*eBay* — One `search` call per plan, on the plan's marketplace (`EBAY_GB`, `EBAY_US`, …; the interviewer offers a "major sites" preset that creates one plan per marketplace), `sort=newlyListed`, `filter=itemStartDate:[since..]` plus optional `itemLocationCountry`, `buyingOptions`, `price`. `enrich` calls `getItem` for the description and full images. `shipsToUk` derived from `shipToLocations`. Application token cached and refreshed.

*Vinted* — For each configured domain, obtain/refresh a session, call the catalog JSON endpoint with `order=newest_first`, page until `since` is reached. 0.8–2.5 s jittered spacing, low concurrency. If the JSON route is blocked, fall back to Playwright rendering the search page with images and fonts blocked. Surfaces a clear "blocked — run this worker from a residential connection or configure a proxy" health status rather than failing silently. **Proxy support:** each source can be given a proxy URL in Settings (`http://user:pass@host:port`, HTTP or SOCKS5), applied to both the HTTP client and Playwright; a Test button reports the exit IP and country. For Vinted this should be a *residential* proxy with a **sticky session** (same IP for the whole poll, so the DataDome cookie stays valid) and **country targeting** matching the domain (GB for `vinted.co.uk`). Traffic is a few MB per day, so a pay-as-you-go per-GB plan with no minimum is the right shape; no proxy is used for eBay, Yahoo or Mercari.

*Yahoo! Auctions JP* — HTML search with newest-first ordering; parse cards; `enrich` fetches the item page for description and image gallery. Yen price converted to GBP.

*Mercari JP* — Internal search API with DPoP token generation; `enrich` fetches item detail JSON. Filter to `on_sale` status.

---

## 6. Scheduling and polling

`pg-boss` provides cron-style scheduling and job queues in Postgres. Each active WantedItem × SearchPlan gets a recurring poll job at the item's interval (default 3×/day, staggered so all eBay calls don't land in the same second). Queue names include the source (`poll.vinted`) so a remote worker can subscribe only to the sources it should handle (`WORKER_SOURCES=vinted`). The separator is a period because pg-boss validates queue names against `/^[\w.\-/]+$/` and rejects a colon.

Each plan keeps its own watermark, advanced only to the newest listing actually processed in that poll, so a missed run — or a poll that hits the candidate cap on a broad query like "macintosh" — carries on from where it stopped rather than skipping. Broad queries are expected and cheap: several hundred new listings a day cost well under £1 a month in pre-filter calls; only survivors reach the vision model. New `(source, externalId)` pairs not in `Seen` become Listings and Candidates. Everything else is ignored, except that `lastSeenAt` is updated for Listings we already hold.

**Existing listings (backfill and scan).** A backfill is a poll with no `since` watermark and a page cap, run once when a spec is agreed if `settings.backfill.enabled`, and on demand from the item page's "Scan current listings" button (rate-limited to once per hour per item). Adapters receive `{ mode: 'backfill', depth }` and fetch up to the cap (default 200 listings per source) at their normal jittered pacing, so for the scraped sources it is one slightly longer poll rather than a different kind of traffic. Candidates created this way carry `origin = backfill|scan`, are reviewed by the same pipeline, and are routed to the item page plus a single summary email — never to real-time emails. Indicative cost: 200 listings → ~70 vision reviews after pre-filtering → 15–45 cents one-off on a mid-tier model.

Safety valves: a per-poll cap on new candidates (default 50) so a bad query like "game" cannot trigger hundreds of reviews; a monthly AI budget cap in settings that pauses reviews and emails you when reached; adapter health failures surface on the dashboard and in the digest.

---

## 7. Matching pipeline

Runs per Candidate in the review worker. Each stage can stop the pipeline early, which is where the cost control comes from.

1. **Normalise.** Currency to GBP (daily ECB rates, cached), text cleaned, images deduped by perceptual hash.
2. **Hard filters (no AI).** Price above ceiling → reject with reason `over_budget` (still visible in the UI). Negative keywords in title → reject `negative_keyword`. Relist detection: same seller + high title similarity or matching image hash against a previous candidate → flag `relistOf`, continue (v1 shows relists; a later setting suppresses them).
3. **Text pre-filter (cheap model).** Title + first ~1,500 characters of description + the spec summary, criteria and a per-item *plausibility note* written by the interviewer ("sellers often omit the model number; all-in-one Performa and Power Mac 5xxx listings are plausible") → `{ plausible: boolean, reason }`. Discards obvious misses ("Carmageddon t-shirt", "Game Boy game only"). Anything plausible or unclear continues. Target: rejects 60–70% of candidates from a targeted query and 90%+ from a broad one, for a few hundredths of a cent each.
4. **Enrich.** Adapter fetches full description and all images; images downscaled to ~1024px longest edge and stored.
5. **Vision review (mid-tier model).** Inputs: spec summary, every criterion with its `kind/quantifiable/onUnknown`, reference images (with their labels, so the model knows which variant each shows), the listing's description and images, the grading scale's example images if attached, and up to five recent Feedback examples for this item. Each reference or grading image costs roughly 1,000–1,500 input tokens per review, so images are downscaled on upload, the item page shows a running "images per review" count, and the UI nudges at six. Output is structured (JSON schema enforced): a result and one-line evidence per criterion, an overall grade if a scale is attached, an English summary of the listing (this is also the translation), and `shipsToUk` if the model can read it from the description.
6. **Decide.** Deterministic, not left to the model:
   - any *hard* criterion `fail` → **reject**
   - any *soft* criterion `fail` → **uncertain**
   - any criterion `unknown` with `onUnknown = surface` → **uncertain**
   - any criterion `unknown` with `onUnknown = reject` → **reject**
   - grade below minimum → reject; grade unknown → uncertain
   - otherwise → **match**
7. **Notify.** `match` and `uncertain` go to the notifier, respecting the item's mode. `uncertain` emails say exactly what was unknown ("manuals not shown or mentioned"). `reject` is stored with reasons and visible in the audit view.

Model instructions for step 5 are explicit about the quantifiable/soft distinction: "if the photos clearly show a crack in the case and the criterion says no cracks, that is a `fail`; if the photos are too blurry to tell, that is `unknown`". The review never sees another wanted item's context.

---

## 8. The interviewer agent

The interviewer is a chat in the web app, backed by a stronger model with tool use. Its job is to turn a vague wish into a spec with no ambiguity the reviewer would trip on.

Flow for a new item:

1. You type the opening description ("Carmageddon big box from the 90s, ideally Mac, PC is fine too").
2. The agent asks targeted questions, one or two at a time: platform, region (PAL/NTSC/any), completeness (box, manual, discs, inserts), condition tolerance, damage that is disqualifying vs acceptable, price ceiling, which sources and countries, notification mode, and whether there are look-alikes to exclude (Carmageddon 2, jewel-case re-releases, Splat Pack expansion).
3. When it has enough, it calls `propose_spec` and the UI shows a **spec card**: summary, criteria table (each marked hard/soft and quantifiable), search plans per source with the actual queries (including Japanese keywords), price ceiling, and reference images.
4. Reference images are sourced by, in order of availability: images you upload (each with a short label such as "DMG-01 yellow, UK box variant"); a `search_images` tool (web image search — needs an optional search API key such as Brave Search; hidden if not configured); or the backfill itself, since every candidate photo has a "use as reference" button. Running the backfill before you click Agree is also the calibration step: you see what each source returns right now and the reviewer's dry-run verdicts, so false positives show up before the spec is frozen.
5. The agent sets a typed field whenever your answer maps to one (price, countries, listing type, condition, notification mode…) and writes a criterion only for things that need reading or looking. The spec card shows the two groups separately, so a leak is visible at a glance.
6. You click **Agree** → `WantedSpecVersion` 1 is frozen and polling starts. Or keep chatting to adjust.

Amendments ("only Macintosh from now on", "missing manuals is fine now") open the same chat with the current spec loaded; the agent proposes a diff, you agree, version N+1 is created. Criteria that did not change keep their ids so feedback history stays attached.

**Nothing is a black box.** The interviewer is a convenience, not a gatekeeper. The item page renders the current spec in full and human-readable: each criterion in plain English with its hard/soft, quantifiable and on-unknown flags; the settings as the toggles and dropdowns they are; the search queries per source exactly as sent; the reference images with labels. All of it is editable directly in a form (creating a new version) without talking to the agent. Every verdict lists each criterion's pass/fail/unknown with its evidence sentence, and a "Show prompt" control reveals the exact text and images the reviewer received; the fixed template around them is in the repository. Spec versions can be diffed side by side.

The agent's output is validated against the spec schema before it is shown; a malformed proposal is regenerated, never persisted.

---

## 9. AI provider abstraction

All model calls go through the Vercel AI SDK, which gives one interface (`generateText`, `generateObject`, `streamText`) over Anthropic, OpenAI, Google, Mistral, OpenRouter, Ollama and others. Goodies Beacon defines three **roles**, each independently configurable in settings or `.env`:

| Role | Purpose | Needs | Suggested tier |
|---|---|---|---|
| `interviewer` | Spec-building chat, amendments, folding feedback into specs | Tool use, structured output; vision helpful | Strong (Claude Sonnet, GPT-5, Gemini Pro) |
| `prefilter` | Text-only plausibility check | Cheap, fast | Cheapest (GPT-5 nano, Gemini Flash-Lite, Claude Haiku) |
| `reviewer` | Vision review + grading + English summary | Vision, structured output | Mid (GPT-5 mini, Gemini Flash, Claude Haiku/Sonnet) |

Configuration is `provider:model` per role, e.g. `AI_REVIEWER=openai:gpt-5-mini`, with an API key per provider. Switching providers is a settings change; no code changes. Ollama is supported for a local model, with the caveat that small local vision models are noticeably weaker at grading.

Cost controls: per-call usage recorded in `CostLedger`; a costs page shows spend per item and per role; a monthly budget cap pauses reviews. Because polls are only a few times a day, reviews can be submitted via the provider's batch API (50% cheaper on Anthropic and OpenAI) with a settings toggle; real-time items skip batching.

Prompt caching: the spec, criteria and reference images are the same for every candidate of an item, so they are placed first in the prompt to benefit from provider-side caching where supported (on Anthropic a cached image costs a tenth of a fresh one).

Image token budget: image cost is proportional to pixel area on Anthropic and OpenAI, and per 768-pixel tile on Google, so the savings come from downscaling on upload (reference images ≈ 800 px, grade examples ≈ 600 px), from caching, and from sending grade images in a second, smaller call only for listings that have already passed the other criteria. The AI layer exposes an image-packing strategy per provider: `separate` (default — each image sent individually with its label as a caption) and `contact_sheet` (several small examples tiled onto one image with labels drawn on and clear borders), which is worth enabling for Gemini-style tile pricing and is a net loss elsewhere because a composite gets downscaled to the provider's per-image cap and loses the detail the reviewer needs.

Indicative monthly cost at your expected volume (≈4,500 candidate listings/month before pre-filtering, September 2026 list prices): pre-filter everything on a cheapest-tier model (< $1), vision-review the ~1,500 survivors on GPT-5 mini (~$3), Gemini Flash (~$10) or Claude Haiku (~$10), plus a few dollars of interviewer usage — comfortably inside $30–50 even at three times the volume, or on a stronger reviewer.

---

## 10. Notifications

Delivery via SMTP (Nodemailer) with STARTTLS/TLS, credentials from settings; works with Gmail app passwords, Fastmail, Resend, Postmark, self-hosted mail.

**Real-time** — sent as soon as a verdict is `match` or `uncertain` for an item in realtime mode and the candidate's `origin` is `poll`. Backfill and scan results are batched into one summary email per run regardless of the item's mode. **Digest** — a cron job at 08:00 in the configured timezone (default Europe/London) collects all un-notified match/uncertain candidates from the previous 24 hours for digest-mode items, grouped by wanted item, and sends one email. Both write a `Notification` row first, so a crash cannot double-send.

Each entry shows: thumbnail, English title, price (GBP and original), auction/fixed and end time, source and item location, ships-to-UK yes/no/unknown, verdict (match / uncertain with the specific unknowns), grade if applicable, a link to the listing, and a link to the candidate page in Goodies Beacon (where "Not a match" lives). Text is plain HTML built from our own template — seller HTML is never embedded. The digest also lists adapter health problems and the month's AI spend.

A quiet-hours setting for real-time emails is trivial to add later if wanted; not in v1.

---

## 11. Deployment

```yaml
# docker-compose.yml (sketch)
services:
  db:      image: postgres:18        # volume: pgdata
  app:     image: ghcr.io/<you>/goodies-beacon   # ROLE=all  (api + workers)
           env_file: .env
           volumes: [media:/data/media]
  caddy:   image: caddy:2            # auto-HTTPS in front of app; required, see §12
```

Split deployment (core on VPS, Vinted worker at home):

```yaml
# on the home machine
services:
  worker:  image: ghcr.io/<you>/goodies-beacon
           environment:
             ROLE: worker
             WORKER_SOURCES: vinted        # subscribe only to poll.vinted
             DATABASE_URL: postgres://…@100.x.y.z:5432/goodies_beacon   # via Tailscale
```

**Reaching the web UI.** Two supported routes, chosen in `.env`; both give a real HTTPS certificate with no manual renewal.

*Public hostname (default).* Point a domain or subdomain you own (or a free dynamic-DNS name) at the droplet, allow ports 80 and 443 in the cloud firewall, set `GOODIES_BEACON_HOST=beacon.example.co.uk`. Caddy obtains and renews a Let's Encrypt certificate automatically, redirects HTTP to HTTPS, and is the only published service; the password login, rate limiting and cookie flags in §12 are the front door. Digest email links open from any device.

*Private via Tailscale.* The droplet joins your tailnet, nothing but SSH is opened in the firewall, and you reach the app at its `*.ts.net` name from any device running Tailscale (phones included). Caddy obtains the certificate for the Tailscale name, so you still get a proper padlock. Email links then only work on devices with Tailscale running.

Tailscale (or WireGuard) is also the recommended way to let a home worker reach Postgres; the database is never exposed on a public interface in either route. Media uploaded by the remote worker goes through the API (`POST /internal/media`, worker token) rather than a shared volume.

Hardware: the whole stack runs on a 2 vCPU / 2 GB VPS (e.g. a basic DigitalOcean droplet) or a Raspberry Pi 5 / Mac mini. Resting footprint is about 1 GB (Postgres 100–200 MB, Node API + workers 200–400 MB, Caddy and Docker overhead under 150 MB); a headless Chromium for the Vinted fallback adds 300–500 MB while it runs, so the worker runs at most one browser at a time and closes it after each poll. Two rules keep 2 GB comfortable: add a 2 GB swap file, and never build the image on the droplet — GitHub Actions builds and publishes it, the droplet only pulls. Resize to 4 GB only if the OOM killer ever appears in the logs. Playwright adds ~620 MB to the image — Chromium's headless shell plus the X, GTK and Mesa libraries it links, none of which can be pared back without the browser failing to start — so the full image is budgeted at 1.0 GB and the `-slim` image without it at 400 MB. Slim is built for API-only deployments and for workers that poll no scraped source.

Backups: nightly `pg_dump` to the media volume; the compose file includes the job. Media is reproducible enough (listing photos) that losing it is not critical.

---

## 12. Security

- **Authentication.** Single user. Password set on first run via the UI, stored as an Argon2id hash in the DB (OWASP's floor: 19 MiB, two passes, one lane). Session cookie `gb_session`: 256-bit random id, `HttpOnly`, `Secure`, `SameSite=Lax`, thirty-day expiry sliding on use, rotated on login and on a password change — which also ends every other session. Login is rate-limited to five failures per fifteen minutes per client address, then a lockout of the same length, and both are logged; the counters are in memory, so the limit is per API container and a restart clears them. Optional TOTP second factor is a small later addition.
- **Secrets.** Marketplace and AI keys, SMTP password: provided through `.env` or entered in Settings; settings-entered secrets are encrypted at rest with a key from `.env` (`GOODIES_BEACON_SECRET_KEY`), masked in the UI and never logged.
- **Seller content.** Descriptions are sanitised (DOMPurify server-side) before storage and rendered as text or sanitised HTML; never inline in emails.
- **Images.** Fetched only by the worker through the adapter's HTTP client with size limits, content-type checks and a private-address block list (SSRF). Re-encoded on ingest.
- **Transport.** Caddy terminates TLS with automatic certificates, by either route in §11. TLS is required rather than recommended: the session cookie is `Secure`, so a browser discards it over plain HTTP and sign-in fails with nothing to explain why. `localhost` is the single exception, because browsers count it as a secure context — which is why local development and the Playwright run need no certificate.
- **Surface.** Only Caddy is published; Postgres and the app listen on the compose network, which is the actual control — not a host firewall. Docker inserts its own iptables rules ahead of `ufw`'s, so a *published* port reaches the internet whatever `ufw` has been told; publishing none for Postgres is what closes it, and the provider's cloud firewall is the defence in depth behind that. CSRF protection on state-changing routes: a double-submit `gb_csrf` cookie, readable by the page, echoed in `X-CSRF-Token` and compared in constant time. Because only Caddy is published, the last `X-Forwarded-For` entry is the one it wrote and the only one a client cannot forge, so that is what rate limiting counts against. Dependabot/Renovate on the repo.
- **Email.** SMTP over TLS; digest links point at your instance URL from settings, never derived from request headers.

---

## 13. Data retention

A nightly job deletes Candidates (and their Verdicts, downscaled images) older than the retention period (default 30 days) unless `retain` is set or the candidate has Feedback. Listings not referenced by any remaining candidate are deleted too. `Seen` rows are never deleted, so a still-live listing is not re-notified. A candidate page has a **Retain** toggle; the digest email has a per-item retain link.

---

## 14. Web UI

React + Vite, TanStack Router and Query, Tailwind. Pages:

*Dashboard* — active items, today's new matches/uncertains, source health, AI spend this month.
*Wanted items* — list with status, mode, last poll, counts. Item page: current spec card (settings, criteria, the search-plan table with per-query stats, labelled reference images — all editable in place), version history with diffs, candidate list filtered by verdict and origin, "Amend" opens the chat, "Scan current listings" runs a backfill.
*Interview* — streaming chat with the spec card alongside; Agree button; preview-search results panel.
*Candidate* — listing photos and English summary, verdict with per-criterion evidence and "Show prompt", actions: Not a match / Challenge (with note), Retain, Use photo as reference, Mark as bought (moves item to `found`).
*Grading scales* — create scales with example images per grade.
*Settings* — sources and credentials with Test buttons (including per-source proxy URL with an exit-IP check), AI roles, SMTP, digest time and timezone, polling defaults, retention, budget cap.
*Costs* — ledger by item, role and month.

---

## 15. Stack and repository layout

**Why TypeScript throughout:** matches your background; the Vercel AI SDK is the most mature provider-agnostic layer and it is TypeScript-first; Playwright is first-class in Node; one language keeps a single container image and a single contribution story. Python's scraping ecosystem is marginally richer but not in ways this project needs.

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node 24 LTS | Active LTS until 2027, maintained until April 2028 |
| Language | TypeScript 6.0 | The bridge release to 7 (same defaults, deprecations as warnings). 7.0 ships without a stable programmatic API until 7.1, so editor and tooling integration is not yet routine; move to 7.x as a deliberate task once 7.1 is out |
| API | Hono | Tiny, fast, typed routes, SSE support, easy OpenAPI later |
| Database | PostgreSQL 18; Drizzle ORM + migrations | Type-safe SQL, minimal magic; 18 is a year into its support life, 19 is still in beta |
| Queue/scheduler | pg-boss | Cron + queues in Postgres, no Redis |
| Scraping | Playwright (only where needed) + undici fetch | Browser fallback only for Vinted |
| AI | Vercel AI SDK (`ai`, `@ai-sdk/*`) | Provider swap by config; structured output; streaming |
| Validation | Zod | Shared schemas between API, UI and adapters |
| UI | React 19, Vite, TanStack Router/Query, Tailwind | Familiar, fast to build |
| Email | Nodemailer + React Email templates | Templates in the same language |
| Images | sharp (resize), blockhash (perceptual hash) | Ingest pipeline |
| Lint + format | Biome, with lefthook pre-commit | One fast tool instead of ESLint + Prettier; `biome ci` in Actions |
| Testing | Vitest 4.1; Playwright for UI smoke tests; recorded HTTP fixtures per adapter; prompt eval fixtures | Adapter and prompt tests run offline without credentials |
| Packaging | pnpm 11 workspaces, single multi-stage Dockerfile on `node:24-trixie-slim`, GitHub Actions → GHCR image | One `docker compose up` for users |

```
goodies-beacon/
  apps/
    api/            Hono server, interviewer agent, routes
    web/            React app
    worker/         pg-boss subscribers: poll, review, notify, retention
  packages/
    core/           domain types, Zod schemas, Drizzle schema, pipeline logic
    ai/             role registry, prompts, provider factory, cost ledger
    sources/
      ebay/  vinted/  yahoo-auctions-jp/  mercari-jp/
      _template/    scaffold for contributors
    email/          templates
  docker-compose.yml
  .env.example
  docs/             ARCHITECTURE.md, ADAPTERS.md, RUNNING.md
```

---

## 16. Developer workflow, CI and deployment

**Local development is the default; the droplet runs tagged releases and builds put there deliberately.** `compose.dev.yml` starts Postgres and Mailpit (a local mail catcher with a web inbox, so digest emails can be inspected without sending anything); the API, workers and web app run on the developer's machine with hot reload from `pnpm dev`. Real eBay and AI credentials are used locally — eBay's sandbox data is not useful — with the monthly budget cap set low. Scraped sources are, if anything, better tested from a home connection than from the VPS. There is no staging server: the droplet is also where a release candidate is proved, deployed on demand through the manual deploy workflow below, so an exit test can be rehearsed without publishing a release. Upgrades on the droplet are roll-forward with a database dump taken first, and rollback is pointing the compose file at the previous image tag.

**Branching.** Until the plan in `DEVELOPMENT_PLAN.md` is complete, task branches merge into a long-lived integration branch (`development/0.2.0`) rather than `main`, and `main` receives a single merge at the end. Releases in that period are tagged from the integration branch: `v0.1.0` at the Phase 0 exit, `v0.2.0` at the Phase 1 exit. Once `main` is current again, task branches base on `main` as normal.

**Code quality.** Biome for linting and formatting across the monorepo, run by a lefthook pre-commit hook on staged files and as `biome ci` in Actions. Strict TypeScript with `tsc -b` across the workspace.

**Dependency policy.** Exact versions, pinned. New or upgraded dependencies use the newest major line that has been generally available for at least a month; never pre-releases, and never a `.0` release younger than a month while the previous line is still maintained. Renovate proposes upgrades weekly; they merge only with green CI.

**Continuous integration** (`.github/workflows/ci.yml`, on every push and pull request): install with a cached pnpm store → `biome ci` → typecheck all packages → `vitest` (unit tests, integration tests against a Postgres service, adapter tests against recorded HTTP fixtures, prompt evals against a fixture set of listings with expected verdicts, run against two providers so a prompt regression is caught) → Vite build of the web app, and a check that `docs/API.md` still matches the route table → a Playwright smoke test against the built API serving the built web app, on a Postgres service → Docker image build without push. On pushes to `main` the image is also pushed to GHCR tagged `edge` and with the commit SHA; pushes to the integration branch push `dev` and the commit SHA, so a manual deploy always has a built image to pull. Renovate keeps dependencies current.

**Release and deploy** (`.github/workflows/release.yml`, on a published GitHub Release tagged `vX.Y.Z`): build the image for amd64 and arm64, push to GHCR tagged with the version and `latest`, then — only if the deploy secrets exist, so forks skip this step — connect to the droplet over SSH as a restricted `deploy` user with a deploy key from the repository secrets and run `deploy.sh`: `pg_dump` to the backup volume, `docker compose pull`, `docker compose up -d` (migrations run on container start), then poll `/healthz` and fail the job if the app is not healthy within two minutes. The compose file on the droplet pins `image: ghcr.io/<you>/goodies-beacon:${GOODIES_BEACON_VERSION}` so what is running is always a known build.

**Deploying without a release** (`.github/workflows/deploy.yml`, `workflow_dispatch`): takes an image tag (defaulting to the integration branch's `dev`) and runs the same shared deploy job as the release workflow, so a build reaches the droplet exactly as a release would without creating a tag or a GitHub Release. There is one deploy path, reachable from two triggers; `deploy.sh` is never duplicated.

---

## 17. Phased development plan

Each phase ends with something you can use. Estimates assume one developer with AI assistance, part-time; treat them as ordering, not commitments.

**Phase 0 — Foundation.** Monorepo scaffold with Biome and lefthook, CI workflow (lint, typecheck, test, build) green from the first commit, Dockerfile and compose files (production and `compose.dev.yml` with Mailpit), Postgres + Drizzle migrations, pg-boss wiring, auth (password, sessions), settings storage with encrypted secrets, `/healthz`, UI shell, release workflow that builds the image and deploys to the droplet. *Exit: a tagged release deploys an empty Goodies Beacon to the droplet over HTTPS and you can log in.*

**Phase 1 — eBay end to end + feasibility spikes.** eBay adapter (search, enrich, health check), poll scheduler, Listing/Candidate ingestion, a manually-written spec (JSON in the UI, no interviewer yet), the full matching pipeline with the AI role abstraction, candidate audit view. In parallel: throwaway spike scripts for Vinted (UK + one EU domain, from VPS and from home), Yahoo Auctions and Mercari, recording what works, at what rate, and the fixtures they produce. *Exit: your Carmageddon search runs 3×/day against eBay and you can read verdicts in the UI.*

**Phase 2 — Interviewer and spec editing.** Chat UI with streaming, typed `propose_spec` (settings/criteria split), backfill-before-agree as calibration, labelled image upload, optional `search_images`, spec versioning with diffs, direct form editing, Agree flow, amendment flow, "Show prompt" on verdicts. *Exit: you create the Power Mac 5500 item by conversation and amend it.*

**Phase 3 — Notifications.** SMTP settings and test send, real-time emails, 08:00 digest, `Notification` idempotency, currency conversion, English summaries in email. *Exit: you stop refreshing tabs for eBay.*

**Phase 4 — More sources.** Vinted adapter (informed by the spike, with blocked-status reporting and cookie persistence), Yahoo Auctions JP, Mercari JP, Japanese query proposals from the interviewer, remote-worker mode (`WORKER_SOURCES`, media upload via API). *Exit: all four v1 sources live; Vinted worker running wherever the spike said it must.*

**Phase 5 — Judgement quality.** Grading scales with example images (editable any time), "Scan current listings" on demand, feedback and challenge loop (re-review, fold into spec), relist detection and the suppression toggle, per-criterion `onUnknown` hardening, retention job, costs page and budget cap, batch-mode reviews. *Exit: the reviewer improves from your corrections; costs are visible.*

**Phase 6 — Open-source release.** README and RUNNING.md, ADAPTERS.md with the `_template` package, `.env.example`, MIT licence, issue templates, a "sources status" table maintained in the repo. *Exit: someone else can run their own instance in fifteen minutes.*

Deferred backlog: Facebook Marketplace (home worker only), Gumtree, quiet hours, TOTP, push/Telegram notifications, ending-soon reminders, sold-price history from retained candidates, and a per-item **variant catalogue** (names, known model/SKU codes, identifying features, reference images) in which a seller-supplied code is one piece of evidence ranked below photos and description — a wrong code can add a note or make a verdict uncertain, never reject on its own; catalogue codes can also seed search queries for the Japanese sources.

---

## 18. Risks and how the design absorbs them

*Scraper breakage* — each adapter is isolated with recorded fixtures and a health check surfaced in the UI and digest, so a break is visible within a day and fixed in one package.
*Vinted blocking from a VPS* — the remote worker mode exists for this reason; the spike decides placement before the adapter is built.
*Mercari signing changes* — single adapter; established community knowledge on the scheme.
*Runaway AI cost* — per-poll candidate cap, monthly budget cap, pre-filter before vision, batch mode.
*False negatives (missed wanted items)* — the audit view exposes every rejection with evidence; uncertain-by-default policy for non-quantifiable criteria; challenge loop feeds corrections back.
*Provider lock-in* — the AI SDK abstraction plus role config; prompts are written provider-neutral and tested against two providers in CI.
*eBay keyset approval* — Browse API is available on a standard production keyset; confirmed in the Phase 1 spike before anything depends on it.

---

## 19. Open decisions

Licence (MIT) and name (Goodies Beacon, repository `goodies-beacon`) are settled. Nothing is open.

The next step is the development plan: Phase 0 and Phase 1 broken into tickets with acceptance criteria, starting with the repo scaffold and the eBay spike.
