# Changelog

All notable changes to Goodies Beacon. Format follows conventional commits; releases are GitHub Releases tagged `vX.Y.Z`.

## Unreleased

- P1-18 Typed spec form. A wanted item's spec is edited through toggles, dropdowns and tables
  rather than by writing JSON: §4's settings as the bounded values they are, criteria and search
  plans as rows that can be added and removed, and the summary and plausibility note as prose.
  The JSON editor stays behind a tab, with its live validation and linter warnings unchanged — it
  is the escape hatch for a paste or a wholesale rewrite, not the only way in.
- Both surfaces edit one document. The form reads the parsed spec and writes back to the raw JSON,
  so switching between them never loses a field the form does not show. An edit in the form does
  re-indent the JSON, as adding a reference image always has.
- A half-finished value keeps the form on screen. An empty criterion, or a poll interval typed one
  key at a time, no longer drops the page to raw JSON: the form draws from a draft parse and shows
  what would stop a save beside the field concerned, while the Save button stays on the strict
  schema. A price ceiling with pence can be saved from the form.
- New criteria and search plans get ids that are never reused, so a criterion added after another
  was deleted does not inherit its feedback, and a plan's watermark is never shared with another
  item's. Changing a plan's marketplace starts a new plan with that source's default region.
- Reference images are visible where they are uploaded. The panel shows each one as a labelled
  thumbnail with the number sent on every review, images can be removed there, and an upload that
  is not yet part of a saved version says so. Leaving the page with one now warns first, instead of
  leaving the stored file behind without a word.
- P1-17 Prompt eval suite in CI. The fixture cases P1-09 and P1-10 left behind — nineteen
  pre-filter listings and eight reviewer listings across both example specs — are now a gate:
  `.github/workflows/prompt-eval.yml` runs them against two providers and fails the build on a
  regression, with precision, recall, the case counts and the spend in the job summary.
- It is its own workflow rather than a step of CI, because it calls real models. It runs when the
  prompts, the fixtures, the example specs or the evaluation code change, and on demand from the
  Actions tab; an unrelated change does not pay for it.
- Each run takes a budget in dollars, checked before every call. Reaching it **fails** the run
  rather than passing early: the cases it never asked about are not evidence that the prompt is
  fine.
- A provider with no key skips with a notice and exits zero, so a fork gets a green build. That is
  decided from the credential before anything runs — the pre-filter fails open by design, so a
  keyless run would report every listing as plausible, find no wrong discards, and look exactly
  like a pass.
- The pre-filter is scored with keeping as the positive class, so recall is the number that must
  be perfect — a wrong discard is the mistake nothing else reports. The reviewer is scored on
  whether the listing would have reached you, by putting both the expected criteria and the
  model's answers through the decision rules, so the prompt is measured against the product's own
  output rather than a second opinion about what the rules would say.
- Fixed: **the pre-filter could not work at all on the model it ships configured to use.** Its
  output ceiling was 200 tokens, on the reasoning that a one-sentence answer needs no more — true
  of the visible answer, false of a reasoning model, where hidden reasoning tokens come out of the
  same allowance. `openai:gpt-5-nano`, the default for the role, spent all 200 reasoning, returned
  nothing and failed on every call. And because the stage fails open by design, nothing said so:
  every listing was kept and sent to the reviewer, so the stage that exists to avoid mid-tier
  prices was quietly charging them. Found by the new evaluation on its first run against OpenAI;
  the check had only ever been pointed at Gemini, which does not reason and answered inside 200.
- **The default pre-filter model is now `google:gemini-3.5-flash-lite`**, not `openai:gpt-5-nano`.
  Measured over twelve runs of the prompt evaluation, gpt-5-nano discarded a water-damaged but
  genuine listing in four of them — always the same one — reasoning that a missing manual made it
  "not the complete big-box set". That is a completeness judgement the pre-filter is told not to
  make, and a wrongly discarded listing is never reviewed, never emailed and never noticed.
  Gemini Flash-Lite did not do it once in eight runs, at the same cost per call. The defaults now
  name three providers; every role is a single line in Settings, and a default that loses a third
  of the listings you might have wanted is not worth keeping for tidiness.
- A malformed-output retry now gets **twice the room** to answer in. The two causes of that
  failure want opposite treatment, and for the common one — a reasoning model that spent its whole
  output allowance thinking and had none left for the answer — repeating the identical call was
  billed and doomed. The pre-filter's own ceiling is 4,000 rather than 2,000, from thirty-eight
  measured calls rather than one.
- The pre-filter and the reviewer now ask for **temperature 0**. Both ran at the provider's
  default of 1 — full sampling variance on what are classification tasks — which matters beyond
  the evaluation: the newest verdict is the authoritative one and Phase 5 re-reviews on demand, so
  a re-review at full temperature was partly a dice roll rather than a second look. It is a
  request rather than a guarantee, and measurement says so: OpenAI's reasoning models refuse the
  setting, and Gemini still varies because thinking is sampled whatever the temperature says.
- The AI SDK's own warnings went straight to the console, round pino, ignoring `LOG_LEVEL` and
  producing an unstructured line per call. They now come through the logger at debug level, once
  per model per warning per process.
- A fixture can now mark an expectation **borderline**: graded and reported, counted in precision
  and recall, but not able to fail the build. Two do — a joblot naming the wanted game among five
  others, and whether a Japanese "unit only" all-in-one counts as a complete machine. Both have
  two defensible answers, so asserting one measured the sampling rather than the prompt, and a
  gate that fails at random on a workflow that spends money is a gate that gets switched off. Each
  marking names the criterion that wants splitting, so it reads as a to-do rather than a shrug.
- Fixed: **the reviewer failed a review now and then for no visible reason.** Its output ceiling
  was the 4096 default, and a thinking model's hidden reasoning comes out of the same allowance:
  `gemini-3.8-flash` ranged from about 1,300 tokens to over 4,000 on the *same* listing, failing
  roughly one attempt in three. That is a candidate dead-lettered at random. The ceiling is 8,000
  now — and a failed call is billed anyway while producing nothing, so this cannot be the dearer
  choice.
- Two of the worked example specs' criteria were settled rather than argued with. "The disc
  **looks** free of deep scratches" was a visual test asked of listings that have no photographs,
  so one provider took the seller's word and the other said unknown; the word is gone. The CRT
  criterion bundles three tests where a seller answers one, and the Japanese fixture no longer
  asserts it — that case exists to test the translation, and the assertion was measuring a model's
  temperament rather than the prompt. **No prompt was changed**: two attempts to fix these in the
  prompt each fixed one criterion and broke another, which is the documented reason to fix the
  spec instead.
- Fixed: **`scripts/` was typechecked by nothing at all.** Each package's tsconfig includes only
  `src`, so the API doc generator and the prompt evaluation — a gate that spends money — were
  outside `tsc -b` entirely. They are in `pnpm typecheck` now, which immediately found a latent
  type error in the doc generator.

- P1-16 Dashboard. The page a session lands on now answers the questions worth asking first: what
  was judged today, what is being watched, whether the marketplaces are answering, what the month
  has cost against the cap, and whether the processes are alive. It is one request, so the panels
  agree with each other rather than each arriving from its own instant.
- **Every figure is a link to the page that explains it.** A count of today's uncertains opens the
  audit view filtered to them; a failing source opens the item whose plan is failing; the spend
  opens the settings where the cap is set. A number you cannot click through to is a number you
  have to take on trust.
- A poll that failed says so on the page, in the adapter's own words, with the date it was last
  working beside it — "failing since Tuesday" rather than "failed" — and names the item it belongs
  to. Finding that out no longer means opening a log or a psql prompt.
- Today means today where you are. Verdicts are counted from midnight in the instance's time zone,
  not midnight UTC: in British Summer Time those are an hour apart, so anything simpler would have
  filed an early-morning match under yesterday for seven months of the year.
- A source with search plans but no poll yet is listed as such, because "eBay, three plans, never
  polled" is exactly what a fresh instance needs to see, and a source that has polled stays listed
  even once its item is paused — its last error is still the last thing that happened.

- P1-15 Candidates and verdicts UI. The audit view requirement 6 asks for: every listing an item
  has been given, filterable by verdict and by origin, with a thumbnail, the English title, the
  price in GBP and in the seller's own currency, the source, the location and the ships-to-UK
  flag. A rejection is one chip away from a match rather than behind a toggle that defaults to
  off, because "everything the reviewer rejected is visible so you can audit it" only holds if
  browsing them is the same act.
- The candidate page: the photographs this instance stored, the English summary, the seller's
  description, and the verdict with a pass, fail or unknown and one line of evidence for every
  criterion that was asked. **Show prompt** reveals the exact text sent and the exact images, in
  the order they were sent, read back from the verdict rather than rebuilt — a rebuild would show
  what would be sent *now*, which is a different answer once the template has changed.
- Why the rules landed where they did is shown beside the evidence, re-derived from the stored
  results and the immutable spec version rather than from a stored copy that could disagree with
  the rules that wrote it.
- Retain is on the candidate page, so a candidate can be kept past the retention period. The
  feedback buttons are there and disabled: the challenge loop is Phase 5.
- The page is built narrow-first, because the digest emails will link to it and be opened on a
  phone: one column, no tables, a gallery that scrolls rather than stretches, and a test that
  fails if anything makes the page wider than the screen.
- Fixed: **a seller's description was stored exactly as the marketplace sent it.** eBay returns
  the description as a full HTML document and ARCHITECTURE.md §12 requires it sanitised before
  storage; nothing did. It is now reduced to text at ingest — tags removed, `<script>` and
  `<style>` contents removed with them, entities decoded — which keeps it out of the database, out
  of the nightly dump and off the page, and incidentally stops the reviewer's character budget
  being spent on `<font face="Arial">` instead of on what the seller wrote.

- P1-14 Wanted items UI. The list says what each item is doing — status, notification mode, when
  it last polled, and how many candidates it has found, matched, left uncertain or not yet
  judged — and each one opens an item page that renders its spec as a card rather than as JSON:
  every criterion in plain English with its hard/soft, quantifiable and on-unknown flags, the
  settings as the bounded values they are, and the reference images under the labels the reviewer
  is shown. "Nothing is a black box" now has a page to be true on.
- The search-plan table, with what each query has found, how much of it was expensive enough to
  review, what came of that, and what the pre-filter charged meanwhile. A plan taken out of the
  spec keeps its stats and is shown as removed, because the candidates it found are still here.
  A plan that is failing now but worked before says "failing since", which is the distinction
  worth acting on.
- Pause and resume, which deliberately writes no spec version: status says whether the instance
  is looking and nothing about what it is looking for, and a version every time a query was
  paused for an evening would make the history answer a question nobody asked of it. The
  scheduler picks the change up within the minute without a restart.
- Fixed: **three quarters of the per-plan stats were never written.** The poll recorded
  `candidates_found` and nothing else, so `candidates_reviewed`, `candidates_matched`,
  `candidates_uncertain` and `prefilter_cost_usd` had sat at zero since P1-07 created the table —
  the item page would have said a query found four hundred listings and nothing about whether any
  of them were worth it. The review worker now records its half: a candidate that reached the
  vision review, what the rules made of it, and the cost of every pre-filter call whichever way
  it went.

- P1-13 Spec editor. Wanted items can be created and amended without the interviewer: a title, a
  status, and the spec as JSON, checked against the real schema as you type so an error names the
  field it is in rather than the document it is somewhere inside. The two worked examples go in by
  pasting them. Reference images are uploaded with their labels from the same page and appended to
  the spec.
- Saving never edits a spec. It writes the next version and points the item at it, so the version
  a verdict was judged under is still there to read; the version history sits under the editor
  with each version's change note. The side-by-side diff is the interviewer phase's.
- P1-02's linter appears beneath the editor as warnings that do not block a save — a criterion that
  is `hard` but not `quantifiable` rejects a listing the photos cannot settle, where `soft` would
  surface it as uncertain. Saying so is the point; refusing it would be the tooling deciding.
- An item starts as a draft and is polled only once it is set active, so a spec can be written,
  read back and corrected before anything is fetched or any model is called.
- The four settings §4 gives both the item and its spec — notification mode, poll interval,
  grading scale and minimum grade — are projected onto the item row on every save. The document is
  what you edit; the row is what the scheduler and the review pipeline read, and a spec saying
  `realtime` beside a column left at `digest` would have been an item that agreed with itself on
  screen and emailed nobody.

- P1-12 Review worker pipeline. The `review` job from ARCHITECTURE.md §7, end to end: normalise,
  the hard filters, the pre-filter, enrichment, media ingest, the vision review, the decision
  rules, the stored verdict and the email. A candidate now goes from "a poll found this" to "you
  have mail" without anyone refreshing a tab — which is the first point at which Goodies Beacon
  does the thing it is for.
- Every stage can stop the pipeline early, and that is where the cost control lives. A listing
  over the price ceiling or carrying a negative keyword is rejected for nothing, with a verdict
  recording why and its model columns left null so nothing pretends a model was consulted. Only
  what survives the pre-filter reaches the model that actually costs money.
- Progress is recorded on the candidate, so a re-delivered job resumes where it got to instead of
  paying for the earlier stages again, and a candidate that already has a verdict is a no-op
  however many times the job arrives.
- A failure at any stage leaves the candidate visibly `failed` with the error on it, retried three
  times with a widening gap. Reaching the monthly AI budget **defers** the review instead, so a
  paused month does not dead-letter candidates that were never looked at.
- The one notification Phase 1 sends: a plain-text email for a match or an uncertain on a
  real-time item that came from a poll, naming the price, the summary, exactly what could not be
  established, and links to both the listing and the candidate. A rejection, a digest-mode item
  and a backfill candidate send nothing.
- The notification row is claimed *before* the email is sent, which is what makes at-most-once
  true: recording it afterwards would let a job that crashed between sending and recording send
  again on its retry. An email that cannot be sent does not fail the review either — the verdict
  is stored and the row is left unsent, which is the record worth being able to find.
- A verdict now records the tokens and cost of judging that one listing, not just the month's
  ledger entry. The two answer different questions, and retention prunes the ledger.

- P1-11 Decision rules. The deterministic function from ARCHITECTURE.md §7 step 6: a hard
  criterion failing rejects, a soft one surfaces as uncertain, and an unknown does whichever the
  criterion (or the item) says it should. It is pure — no database, no clock, no model — so a
  verdict can always be explained from the rules and the stored results, and re-running it on the
  same inputs gives the same answer for ever.
- The reviewer has no way to express a decision at all: its schema carries no `decision`,
  `reasons` or `verdict` field, and a test asserts it, so a model's opinion cannot reach a verdict
  without going through the rules.
- §7's rules are listed in reading order rather than severity order, so all of them are evaluated
  and the worst outcome wins. Stopping at the first rule that fired would let a soft failure mask
  a hard one and email a listing the rules meant to reject.
- A grade that cannot be checked — none reported, no scale attached, or a label that is not on the
  scale — surfaces as uncertain rather than passing, because a minimum the instance cannot
  actually check is a configuration fault and silently matching would hide a broken scale behind a
  stream of apparently fine verdicts.

- Fixed: **a malformed model response was never retried.** The AI SDK's `maxRetries` covers
  retryable *API* errors — a 429, a 5xx, a dropped connection — and a response that parsed but did
  not match the schema is not one of them, so setting it (which is what P1-08 did, and documented
  as the malformed-output retry) bought nothing: `generateObject` gave up on the first attempt.
  Every role now gets one genuine second attempt at a structured answer before the call is treated
  as a failure, which matters most for the reviewer, where the alternative is a candidate marked
  failed over a single bad response. Found by a test that counted the calls.

- P1-10 Reviewer. The vision review from ARCHITECTURE.md §7 step 5: the item's spec, its criteria,
  its reference photographs with their labels and then the listing itself — description and
  photos — go to whichever model the `reviewer` role is set to, and come back as a pass, fail or
  unknown with one line of evidence for each criterion, an English summary of the listing, and
  whether it ships to the UK.
- The reviewer never decides. It reports evidence and P1-11's deterministic rules read it, so "why
  was this rejected" is always answerable from the rules rather than from a model's mood.
- It is written to prefer **unknown** to a guess. The whole point of §7's unknown handling — the
  `onUnknown` flag, the "manuals not shown or mentioned" email — is worthless if the model reasons
  from what is normally included rather than from what it can actually see, so the prompt says so
  at length and a fixture case exists to catch it.
- A criterion the model did not answer is recorded as unknown rather than dropped. Zod proves the
  shape of a response, not that it answered the question, and a dropped criterion would let a
  silent omission read as a pass.
- Where the pre-filter fails open, the reviewer **fails loudly**: there is no later stage to catch
  what it missed, so a review that could not be completed leaves the candidate visibly failed for
  P1-12 to retry, carrying the prompt that was sent so the failure can be inspected.
- A listing's title and description are fenced in the prompt as the seller's own words and the
  model is told to treat them as data rather than instructions. A description is written by a
  stranger who would like their listing emailed to you; one of the fixture cases is a listing that
  asks the reviewer to mark everything as passed.
- The exact prompt and the list of images sent are returned with the verdict so the UI's "Show
  prompt" is a read rather than a rebuild. Images are named, not embedded — base64 bytes per
  verdict would dwarf every other row in the database and the nightly dump with it.
- Eight fixture cases and `pnpm --filter @goodies-beacon/ai reviewer-check` to run them against a
  real model, grading each criterion, `shipsToUk` and the summary separately. Gemini 3.6 Flash
  scores 41/41 for about 5p, and ignored the fixture listing that tells the reviewer to mark
  everything as a match. They carry their evidence in the seller's text, because there are no
  listing photographs in the repository to commit: they prove the reviewer reads evidence, reports
  unknowns and translates, and they do not prove it can read a photograph.
- The check is paced at four requests a minute rather than the pre-filter check's twelve. The
  reviewer-tier free tiers are much tighter than the cheap models' — five requests a minute and
  twenty a day on Google's — so a faster run reports most of its cases as failures of the model
  rather than of the rate limit.

- Fixed: **structured output did not work on OpenAI at all**, in the configuration the AI roles
  ship with. A Zod `.default()` makes a field optional, an optional field is left out of the JSON
  Schema's `required` list, and OpenAI refuses such a schema outright — *"'required' is required to
  be supplied and to be an array including every key in properties"*. Three of the reviewer's four
  fields and one of the pre-filter's two carried defaults, so `openai:gpt-5-nano` — the shipped
  default for the pre-filter role — could not answer a single call, while Gemini accepted the same
  schema happily. Found by running the pre-filter check against both providers rather than one.
  Optionality is now expressed as `nullable`, which is portable, and `model-schemas.test.ts` walks
  every model-facing schema at every level and fails if an optional field returns. Nothing had
  shipped against a model yet, so no stored verdict is affected.

- P1-09 Pre-filter. The cheap text pass from ARCHITECTURE.md §7 step 3: a listing's title and the
  first 1,500 characters of its description, with the item's summary, criteria and the
  interviewer's plausibility note, judged as `{ plausible, reason }` by whichever model the
  `prefilter` role is set to. Its job is to stop obvious rubbish — a t-shirt, a soundtrack, a
  sequel, a manual on its own — reaching the vision model, which is where the money goes.
- It is built around the fact that its two mistakes are not symmetrical. A listing wrongly kept
  costs a fraction of a penny and the reviewer catches it; one wrongly discarded is never
  reviewed, never emailed and never noticed. So the prompt is explicitly reluctant to reject,
  the criteria are passed as context labelled "do not apply these yourself", and the stage
  **fails open** — a model that cannot be reached, or that answers something unparseable, keeps
  the listing and records that nothing was asked rather than silently dropping it.
- The prompt is a versioned module in `packages/ai/src/prompts/` with a changelog header saying
  what each version tried and why, because a verdict records which prompt produced it.
- Nineteen fixture cases for the two example specs, and
  `pnpm --filter @goodies-beacon/ai prefilter-check` to run them against a real cheap model. It
  reports wrong discards and wrong keeps separately and fails on the first; it also fails when a
  case could not be run at all, since a check whose subject fails open would otherwise report a
  green run with no API key configured. Scored 19/19 on Gemini 3.1 Flash-Lite for under half a
  penny, with no wrong discards.
- The check paces itself at twelve requests a minute by default, because the free tiers it is most
  likely to be pointed at are measured per minute and a rate limit in the middle of a run reports
  as a prompt failure. `--rpm` raises it on a paid key.

- P1-08 AI layer. `packages/ai` is now the only place a model is called: three roles
  (interviewer, pre-filter, reviewer) each configured as `provider:model`, reached through the
  Vercel AI SDK over Anthropic, OpenAI, Google, OpenRouter and Ollama. A caller names a role and a
  Zod schema and never a provider, so changing which model judges your listings is a Settings
  change. Settings gains an AI section with a key per provider — stored encrypted, never sent back
  to the browser, and falling back to `.env` — a Test button per provider that makes a real call
  with the model a role is actually set to, a monthly budget cap, and the image strategy.
- Every call is recorded to `cost_ledger` with its role, item, candidate and cost, computed from a
  price table in the repo carrying the date it was last checked. A model that is not in the table
  records its cost as *unknown* rather than zero and warns once — a zero would read as "this was
  free" on the costs page and let the budget cap run past its limit.
- Cached input is counted and charged apart from fresh input. The SDK reports `inputTokens` as the
  total including cache, so recording that alongside the cache figures would bill the same tokens
  twice and make a cached review look several times dearer than it was.
- The monthly budget cap pauses reviews rather than failing them: a deferred review runs next
  month, or as soon as the cap is raised, where a failed one would exhaust its retries against a
  condition no retry can fix and dead-letter a candidate. Reaching it writes one event for the
  month however many jobs meet it, enforced by a unique index rather than by convention.
- Fixed: the container would not start. `apps/api` gained a dependency on the AI package for the
  Settings Test buttons, and the Dockerfile copies workspace build output package by package, so
  the image shipped a `node_modules` link to `@goodies-beacon/ai` with no `dist` behind it and
  died at import with `ERR_MODULE_NOT_FOUND`. This is the second time — P1-04 did the same thing
  with the eBay adapter — and the comment asking the next person to remember did not prevent it,
  so `scripts/check-workspace-dists.mjs` now runs inside the image build and fails it, naming the
  package and the line to add. Verified by removing the COPY again and watching the build stop.
- Fixed before it shipped: a prompt image given as a URL would have been fetched by the AI SDK
  itself, sending a marketplace-supplied address out of the worker with none of the protections
  P1-05 built — no private-address block list, no size cap, no content-type check. Prompts now
  take bytes this instance has already fetched under guard, and a remote URL is refused with an
  error saying so.

- P1-07 Poll scheduler and candidate ingestion. Every active wanted item's search plans now get a
  pg-boss cron schedule at the item's interval — three times a day by default, staggered by a hash
  of the plan id so a hundred plans do not all fire in the same second — and the poll job stores
  what the adapter returns as listings, candidates and review jobs. Schedules are reconciled from
  the database every minute rather than written once at startup, so pausing an item or changing its
  interval takes effect without a restart. Settings gains polling defaults: the global interval and
  the two caps.
- Two corrections to ARCHITECTURE.md fell out of building it, both now in v1.26. §6 said a listing
  already in `seen` is ignored, but `seen` is keyed on `(source, externalId)` and so is global,
  while a candidate is per wanted item — two items searching the same marketplace would have
  starved each other, silently, with the first to poll taking the listing. The per-item test is the
  `candidates` unique index instead. And §6's "carries on from where it stopped" could not be true
  as written: sources page newest-first, so a run that stops at the cap takes the newest N and
  leaves an unreachable gap behind it. `SearchRequest` now carries an optional `until` beside
  `since`, and a capped run records the window it still owes so the next runs walk it backwards
  until it is empty. A plan's *first* run is exempt, since its window is the whole history of the
  query and sweeping that is what the backfill setting is for.
- A failed poll is recorded against the plan — the error and the run time, with the last success
  left standing so the dashboard can say "failing since" rather than only "failed" — and retried
  with a widening gap rather than immediately, because the usual causes fix themselves given a
  pause and hammering them is what turns a blip into a block.
- An item's poll interval is snapped up to a period cron can actually express. A cron step runs
  within its field, so `*/7` on the hour fires at 0, 7, 14, 21 and then 0 again — a three-hour gap
  in what was asked to be a seven-hour cycle. It is also clamped to the source's own
  `recommendedMinInterval`, whatever the item asks for.

- P1-06 Currency conversion. Daily ECB rates from frankfurter.dev cached in a new `fx_rates`
  table, and `toGbp(amount, currency)` returning both the converted price and the publication date
  of the rate it used, which is recorded on the listing. Rates are kept per date rather than
  overwritten, so a verdict from months ago can still be explained; the ECB publishes on working
  days only, so the rate date is frequently not the day a listing was seen. A missing rate falls
  back to the newest stored one with a single warning rather than failing a poll — a price at
  Friday's rate beats no price — and a currency that has never had a rate converts to null.

- Fixed: `.gitignore` had a bare `media/`, meant for the runtime media volume, and a bare pattern
  matches a directory of that name at *any* depth — so `packages/core/src/media` and
  `apps/api/src/media` were never committed. Everything built and tested locally and CI failed at
  import. Biome reads `.gitignore` too (`vcs.useIgnoreFile`), so those files were also going
  unlinted and unformatted: one mistake quietly disabled two gates. The root-only patterns are now
  anchored with a leading slash, and `scripts/check-tracked-sources.sh` fails the lint job and the
  pre-commit hook if a file under `src/`, `scripts/` or `fixtures/` is ignored.

- P1-05 Media ingest. Listing and reference images are fetched behind an SSRF guard, size-capped
  at 15 MB, re-encoded to webp with a thumbnail, perceptually hashed and stored under `MEDIA_DIR`
  with a row; `POST /api/media` takes an upload and `GET /api/media/:id` serves it with an
  immutable cache header. Re-encoding rather than storing what arrived is what strips EXIF — which
  can carry a seller's GPS coordinates — and means a file that is not really an image never
  reaches the disk.
- The perceptual hash is a difference hash computed with sharp rather than the `blockhash` package
  ARCHITECTURE.md §15 names: the published package is a single release from 2019 with no types,
  and it needs raw pixels, so sharp is in the pipeline either way. The threshold was measured, not
  guessed — a real photograph resized and re-encoded moves 5–7 bits of 64, two different ones
  18–46 — so ten separates them with room either side.

- P1-04 eBay adapter. Search across any eBay marketplace with the plan's region, `newlyListed`
  ordering and the watermark as an `itemStartDate` filter, paging until the watermark or the cap;
  `getItem` for the description, full images and ships-to-UK; a health check reporting the daily
  Browse quota; and an application token cached and refreshed a minute before it expires. Settings
  gains a Sources section for the eBay keyset and an optional per-source proxy, both stored
  encrypted and never sent to the browser, with a Test button that runs the adapter's own health
  check — so what Settings reports is what a poll would hit.
- Fixed before release: the container would not start. `apps/api` gained a dependency on the new
  eBay adapter package for the Settings Test button, and the Dockerfile copies workspace manifests
  and build output package by package, so the image was built without it and died at import with
  `ERR_MODULE_NOT_FOUND`. Caught by CI's "the image starts and answers /healthz" step, which is
  the only thing that would have.
- All three things S1-01 found are handled and pinned by tests: an auction reports `price: null`
  with the figure in `currentBidPrice`, `itemLocationCountry` takes one value and silently ignores
  the `{A|B}` set form, and ships-to-UK is only knowable after enrichment.

- P1-03 Adapter contract, context, template and test harness. `SourceAdapter` and
  `AdapterContext` from ARCHITECTURE.md §5, a rate-limited HTTP client with jittered spacing and
  proxy support, a cookie jar persisted in a new `source_cookies` table so a session survives a
  restart, a Playwright browser factory in the worker that runs one browser at a time and blocks
  images and fonts, a working example adapter in `packages/sources/_template`, and a fixture
  harness that replays recorded responses and validates what an adapter returns. `docs/ADAPTERS.md`
  is the first draft of the contributor guide.
- Fixed before it shipped: the proxy setting would silently never have applied. A `ProxyAgent`
  built from the installed undici is rejected by Node's global `fetch`, which is a different copy
  of the same library; the client now uses undici's own `fetch` for both. Found by running a real
  proxy in the test rather than asserting that the option was passed.

- **Test files are typechecked.** Every package's `tsconfig.json` excludes `*.test.ts` so tests
  never reach `dist/`, with the side effect that `tsc -b` checked none of them — 30 files, a third
  of the TypeScript in the repo, and Vitest does not typecheck either since esbuild strips types
  without reading them. A new `tsconfig.tests.json` checks them with `noEmit`, run by
  `pnpm typecheck` after the build. It found eleven real errors, all pre-existing: three hand-made
  `Logger` stubs missing `child`, two `as Config` casts claiming eleven fields that were not there,
  `Pool` imported from a package `apps/api` does not depend on, two `Hono` variables typed without
  their context, and an unchecked buffer index. One was a live weakness rather than a nuisance: a
  settings test asserted a stored password was `not.toBe('hunter2')`, which `undefined` also
  satisfies, so a write that silently stored nothing would have passed.

- P1-02 Core types and Zod schemas. `SpecSettings`, `Criterion`, `SearchPlan`, `ReferenceImage`,
  `WantedSpec`, the normalised listing and the reviewer's output, shared by the API, the web app,
  the adapters and the AI layer, with the Carmageddon and Power Mac 5500 example specs kept as
  JSON fixtures. Price ceilings, listing types, condition and regions are typed fields with
  bounded values, applied as hard filters before any model is called.
- The criteria linter §4 described is not built, and ARCHITECTURE.md §4 is amended to say so
  (v1.24). It would have matched criteria text against prices, countries and listing types, none
  of which are loose — the only route to a price in a criterion is hand-typing one into the raw
  JSON editor, which Phase 3 closes twice over. One check is kept: a criterion that is `hard` but
  not `quantifiable` is flagged, because `hard` sounds like the careful choice while actually
  meaning a blurry photo rejects the listing outright. It compares two typed fields rather than
  matching English, so it cannot misfire, and it is a warning rather than an error.

- P1-01 Domain schema. The tables from ARCHITECTURE.md §4 — wanted items, immutable spec versions,
  per-plan search state, listings, `seen`, candidates, verdicts, the cost ledger and media, plus
  stubs for grading scales, feedback and notifications. `listings` carries a `seller_hash` and no
  column that could hold a seller name. The salt behind that hash lives in a new `instance_secret`
  row, encrypted under `GOODIES_BEACON_SECRET_KEY` rather than derived from it, so rotating that
  key re-wraps a single value instead of silently orphaning every hash already written and
  breaking relist detection with nothing to notice. `docs/RUNNING.md` gains a *Rotating the secret
  key* section, since the salt is the one thing a rotation cannot simply re-enter.

- **Goodies Beacon stores no marketplace user data.** `Listing` keeps a `sellerHash` —
  `HMAC-SHA256(seller id, instance salt)` — instead of the seller's id and username, and the
  entire `seller` object is dropped before the raw response is stored, so nothing about a seller
  reaches the database, a backup or a log — not just the username: eBay returns a business
  seller's legal name, street address and email in `seller.sellerLegalInfo`, and one in three
  listings sampled during the spike was a named individual with their home address. Relist detection only ever asks whether two candidates share a seller, which a
  hash answers as well as a name, and no screen or email ever displayed one. Found while running
  the eBay spike: a production keyset is issued **disabled** until the application either hosts an
  account-deletion notification endpoint or claims eBay's exemption for not persisting eBay user
  data, and this makes the exemption true rather than merely asserted. ARCHITECTURE.md §18 had
  predicted no such gate; §2, §4, §7, §12 and §18 are corrected in v1.23 and the evidence is in
  the new `docs/SPIKES.md`.
- `docs/SPIKES.md` records the Track A findings as they are made, one section per source. S1-01
  (eBay) is run and written up: Browse works on a production keyset once the account-deletion gate
  is passed, with a 5,000-call daily quota; `EBAY_GB` returns worldwide sellers by default;
  `itemLocationCountry` takes one value and silently ignores the `{A|B}` set form; an auction's
  `price` is `null` with the value in `currentBidPrice`; and ships-to-UK is only knowable after
  enrichment, since `shipToLocations` comes from `getItem`. Eighteen anonymised fixtures are
  recorded for the adapter tests in P1-04.

- The plan for Phase 1 was revised at the Phase 0 exit (`docs/DEVELOPMENT_PLAN.md`,
  ARCHITECTURE.md §17 v1.22): the eBay spike goes first; P1-13 shrinks to the JSON spec editor
  §17 always described, with the typed form and version diff moved to the interviewer phase;
  P1-12 sends a plain real-time email for a match, since the transport already exists; the eval
  suite runs only when prompts, fixtures or its own code change; and Phases 2 and 3 are swapped
  so notifications and retention come before the interviewer.

- P1-00 Hardening from the Phase 0 review. Sessions: the database now stores the SHA-256 of the
  cookie token rather than the token itself, so a copy of the database or a backup cannot be
  replayed as a signed-in session. **Upgrading signs every browser out once.** Every response now
  carries HSTS, a same-origin Content-Security-Policy, `frame-ancestors 'none'`, `nosniff` and a
  strict referrer policy. Nightly and pre-deploy dumps are written owner-only, since they hold the
  password hash, the encrypted SMTP password and the session table, and RUNNING.md's copy-off
  command changes to suit. Container logs are capped at five files of 10 MB per service.
- RUNNING.md step 2 now locks SSH to keys and disables root login, and the plan carries a
  "later hardening" list so the smaller items from the review are not lost.

## v0.1.0 — 13 September 2026

Phase 0 exit. Published as a GitHub pre-release, since nothing works yet: the release exists to
prove the pipeline, not the product. Everything below the exit record was merged during Phase 0.

**Exit test, as run.** `v0.1.0` was created on GitHub from `development/0.2.0`. The release
workflow built both images for amd64 and arm64, rewrote the release notes from the commits, and
deployed through the shared deploy job over SSH, with the forced-command key, in 28 seconds.
`/healthz` on `https://beacon.flibbleware.app` reports `v0.1.0` and the tag's commit, over a
Let's Encrypt certificate with HTTP redirected. The instance was claimed, the empty dashboard
shown, and a test email sent from Settings through Resend was delivered and authenticated at the
notification address.

**Deviations.**

- The droplet was an existing one rather than fresh, and the stack was first started on the
  `dev` image before the release, so the release deployed as an upgrade over `deploy.sh` rather
  than a first install. The password was set on the `dev` build; the sign-in, dashboard and test
  email were then repeated on the released image.
- P0-12's timed walk-through is left unticked: about fifty minutes on the existing droplet, with
  help beyond the guide, roughly half of it on gaps the guide now closes. A timed re-run on a
  throwaway droplet is what ticks it.
- The exit test found nine defects or gaps, all fixed before the tag and each listed below: the
  release tag mismatch, the unrestorable pre-deploy dump, `.env` overriding the baked version and
  commit, the Postgres password character set, the branch download URLs, DigitalOcean's outbound
  SMTP block, amd64-only branch images, the backup container ignoring SIGTERM, and a race in the
  smoke test.
- The Playwright run was not pointed at the droplet, by design: it resets the instance's password.
- Two follow-ups are written into the plan as carried-forward tasks: a first-run setup token, and
  a bootstrap script that writes the instance's files and secrets itself.

- Fixed: the Playwright smoke test could fail on a slow CI runner by reloading the page while a
  settings save was still in flight; it now waits for the section's "Saved." status. Retries are
  off, because the database is reset once per run and a retry would start at first run against an
  instance whose password is already set.

- The window between first start and the owner setting a password, during which anyone reaching
  the instance can claim it, is now stated in ARCHITECTURE.md §12 and a first-run setup token is
  planned for Phase 6 (`docs/DEVELOPMENT_PLAN.md`, carried forward from the Phase 0 exit test).

- Fixed: `/healthz` on the droplet reported `sha: unknown`, and would have reported `version:
  latest`, because `.env.example` listed `GOODIES_BEACON_SHA` and `GOODIES_BEACON_VERSION` and
  compose loads `.env` into the container over the values the image was built with. The baked
  values now live under `GOODIES_BEACON_BUILD_VERSION` and `GOODIES_BEACON_BUILD_SHA`, which are
  not operator settings and are kept out of `.env.example` by a test; `GOODIES_BEACON_VERSION` in
  `.env` is now only the tag compose pulls. Found by the Phase 0 exit test.
- The Postgres password must be letters and digits only, because `docker-compose.yml` splices it
  into `DATABASE_URL` unencoded; `.env.example` and RUNNING.md now say so and suggest
  `openssl rand -hex 24`, and the configuration error names the cause. Found by the exit test.

- Fixed: a published release would have failed to deploy. The release workflow tagged images
  with the version number alone (`0.1.0`) while handing the deploy job the release's tag name
  (`v0.1.0`), so the pull on the droplet found nothing. Images are now tagged with the tag name
  as it is, which is also what `/healthz` reports and what `deploy.sh` takes.
- Fixed: the dump `deploy.sh` takes before a deploy now uses the same flags as the nightly one,
  so it can be restored by the procedure in `docs/RUNNING.md` — over a live database, and without
  the pgboss errors a plain dump prints. It also reads the database role from the container rather
  than assuming the default, so a custom `POSTGRES_USER` no longer aborts every deploy at the dump.
- Fixed: the `backup` service stops as soon as it is asked. It is PID 1 in its container and had no
  signal handler, so every `docker compose stop` or deploy waited out the ten-second timeout before
  killing it. A dump in progress still finishes before it exits.
- Sessions that expired without being presented again are now swept whenever a new session is
  minted, so the table no longer keeps a row per sign-in for ever.
- A settings save that submits an SMTP password which happens to look like a stored envelope is
  now encrypted like any other, rather than stored as sent and left undecryptable.
- Docs brought back in step with the code: README no longer says the compose files are still to
  come or that P0-06 is next; RUNNING.md names the heartbeat queue with the period pg-boss requires
  and says where `ROLE` is actually decided; ARCHITECTURE.md §11 and §16 describe the `./backups`
  directory the backup service and `deploy.sh` really write to; CLAUDE.md states the integration
  branch and the branch naming in use; and the Costs page in the navigation is labelled Phase 5,
  which is when §17 schedules it.

- Work merges into the `development/0.2.0` integration branch until Phase 1 is complete; `main` receives a single merge at the end. `v0.1.0` is still tagged from the integration branch at the Phase 0 exit.

- HTTPS is now stated as required rather than recommended (ARCHITECTURE.md §11 and §12). The
  session cookie has been `Secure` since P0-07, which a browser discards over plain HTTP, so the
  "HTTP on the tailnet is acceptable" allowance §12 carried would have left a Tailscale-only
  instance unable to sign in at all, with nothing on screen to say why. `localhost` is the one
  exception, so local development and the Playwright run still need no certificate.
- P0-14 Nightly backup job: a `backup` service takes a `pg_dump` every night at `BACKUP_AT`
  (03:30 UTC by default), keeps `BACKUP_KEEP_DAYS` of them (fourteen), prunes the rest, and reports
  each run on stdout. Dumps go to `backups/` beside the compose file rather than into a Docker
  volume, where `deploy.sh` already writes its pre-deploy dumps and where they can be copied off
  with `scp`. `docs/RUNNING.md` documents restoring, and rehearsing a restore against a scratch
  database without touching the live one.
- The dump covers the `public` and `drizzle` schemas and deliberately not `pgboss`: its jobs are
  transient, pg-boss rebuilds its schema on start, and including it made a restore print errors
  about inherited constraints on its partitioned tables that an operator could not tell apart from
  a real failure.
- P0-13 Release workflow and deploy script: publishing a GitHub Release builds and pushes both
  images for amd64 and arm64, writes the release notes from the conventional commits since the last
  tag, and deploys. The *Deploy* workflow puts any built tag on the droplet on demand, defaulting to
  `dev`, which every push to the integration branch now publishes. Both triggers share one job, so
  `scripts/deploy.sh` has a single caller.
- `scripts/deploy.sh` dumps the database, pulls, switches `GOODIES_BEACON_VERSION`, restarts and
  polls `/healthz` for two minutes — putting the previous version back and restarting it if the new
  image never becomes healthy, so a failed deploy leaves the working image running.
- The deploy key is restricted to `deploy.sh` by a forced command in `authorized_keys`, so a stolen
  `DEPLOY_KEY` can deploy a published image and nothing else. The tag arrives in
  `SSH_ORIGINAL_COMMAND` and is refused unless it looks like a tag.
- `GOODIES_BEACON_IMAGE` now holds the whole image reference including the registry, so a fork can
  point it somewhere other than GHCR.
- P0-12 Droplet bootstrap and RUNNING.md: `docs/RUNNING.md` now starts from a fresh Ubuntu 24.04
  droplet and ends at a login page — cloud firewall, bootstrap, DNS, the three files, first start,
  and claiming the instance — followed by upgrade and rollback, backups, and the operational
  reference that was already there. `scripts/bootstrap-droplet.sh` does the mechanical parts: a
  `deploy` user that can use Docker without sudo, Docker Engine and Compose from Docker's apt
  repository, a 2 GB swap file with an fstab entry, and `/opt/goodies-beacon`. It is safe to run
  again; every step checks for its own result first.
- P0-11 Docker images and compose files: two images from one Dockerfile — the default with
  Chromium for the browser-driven adapters, and `:slim` without it. `docker-compose.yml` runs `db`,
  `app` and `caddy` with per-container memory limits and only Caddy published;
  `compose.dev.yml` runs Postgres and Mailpit for `pnpm dev`. Caddy handles TLS and the HTTP
  redirect, with a second Caddyfile for a tailnet name that Let's Encrypt cannot certify.
- The full image's size budget is 1.0 GB rather than 900 MB: §11 estimated Playwright at ~500 MB
  and it costs ~620 MB. The Mesa and LLVM libraries that account for 180 MB of it cannot be
  removed — Chromium will not start without them. The slim image measures 343 MB against its
  unchanged 400 MB budget.
- Fixed: the image was missing `packages/email/dist`, so every container built since P0-10 would
  have died on start with `ERR_MODULE_NOT_FOUND`. CI now starts the built image and calls
  `/healthz`, which is what would have caught it.
- Fixed: `NODE_ENV=development` in `.env.example` would have overridden the image's own setting on
  the droplet, leaving the API refusing to serve the web app. It is gone from `.env.example`, and
  compose pins `NODE_ENV=production` where `env_file` cannot reach it.
- The runtime image no longer installs the web app's dependencies — React, TanStack and Zod are
  build inputs, and the image ships the compiled output.
- P0-10 Settings and SMTP test send: the Settings page gains an account section that changes your
  password and an email section for SMTP. The SMTP password is encrypted with
  `GOODIES_BEACON_SECRET_KEY` before storage and never sent back to the browser, which is answered
  with `passwordSet` instead — so saving without retyping it keeps it. "Send test email" mails the
  configured notification address and nothing else, reporting what the mail server said verbatim
  when it fails.
- The API and the web app now validate settings against one Zod schema, imported from the new
  `@goodies-beacon/core/schemas` entry point. The package root reaches Postgres, pg-boss, pino and
  the native argon2 binding and cannot be bundled for a browser; the new entry point reaches none of
  them, and a test walks its import graph to keep it that way.
- Nodemailer 9 rather than 10: major 10 shipped eight days ago, short of the month the dependency
  policy asks for.
- P0-09 Web shell: React 19 with TanStack Router and Query and Tailwind 4. A login page that
  doubles as first run, an empty dashboard, and a settings page that saves the instance section.
  Left-hand navigation carries the pages from §14, with the ones that have no route yet disabled and
  labelled with the task that brings them. Dark and light follow the operating system. An
  unauthenticated visit lands on login; visiting login while signed in goes to the dashboard.
- A Playwright smoke test walks first run, sign out, a wrong password, sign in, a deep-link refresh
  and saving a setting against the built API serving the built web app, and runs in CI against a
  Postgres service. Point `E2E_BASE_URL` at a running instance to rehearse a deploy the same way.
- P0-08 API skeleton: `/healthz` reports `{ status, version, sha, db }` and answers 503 when the
  database is unreachable — including when it accepts the connection and never replies, which would
  otherwise hang the caller. The version and commit are baked into the image at build time. pino
  logging with a request id on every line and in every response's `X-Request-Id`; an unhandled error
  logs its stack against that id and answers a generic 500 without one. `/api/settings` reads and
  writes the instance section (timezone, digest time), merging a partial save rather than resetting
  what it was not sent. In production the API also serves the built web app with a fallback to
  `index.html`, so deep links survive a refresh.
- `docs/API.md` is generated from the route table by `pnpm docs:api`; CI fails if it is out of date.
- P0-07 Authentication: single user, password set on first run and hashed with Argon2id at OWASP's
  floor (19 MiB, two passes, one lane). `POST /api/auth/first-run`, `/login`, `/logout` and
  `/password`, plus `GET /api/auth/session` for the web app to ask where it stands. Sessions are a
  256-bit id in an `HttpOnly; Secure; SameSite=Lax` cookie, expiring after thirty days and sliding
  on use, rotated on login and on a password change — which also ends every other session. Login is
  limited to five failures per fifteen minutes per client address, then a lockout of the same
  length, and every attempt is logged. State-changing `/api` requests need a double-submit CSRF
  token. Every other `/api` path answers 401 without a session, including paths with no route.
- The API entrypoint needs the database to build the app, so `createApp` now takes `{ db, logger }`.
- Vitest no longer runs test files in parallel: the integration tests share one `TEST_DATABASE_URL`
  and each clears the tables it uses, so two files at once pulled rows out from under each other.
- P0-06 pg-boss and process roles: one entrypoint for every `ROLE`, so `all` runs the API and the
  workers in a single process while `api` and `worker` split across containers. Queues live in the
  `pgboss` schema of the same database; `WORKER_SOURCES` narrows a worker to `poll.<source>` queues
  and nothing else. A `heartbeat.<role>` job every five minutes records `last_seen_at` per role in
  the new `process_heartbeat` table. SIGTERM stops the HTTP server, lets in-flight jobs finish, then
  closes the pool, exiting 0.
- `pnpm dev` now runs the API (which carries the workers under `ROLE=all`) and the web app; the
  worker is no longer a separate dev process.
- Queue names use a period rather than the colon ARCHITECTURE.md §6 wrote — `poll.vinted`, not
  `poll:vinted` — because pg-boss validates queue names against `/^[\w.\-/]+$/` and rejects a
  colon outright. §6 and the plan are corrected.
- CI's Tests job now runs a `postgres:18` service and sets `TEST_DATABASE_URL`, so the migration and
  pg-boss integration tests run on every pull request instead of skipping.
- P0-01 Repository and monorepo scaffold.
- P0-02 Biome, lefthook, editor config.
- P0-05 Postgres, Drizzle and migrations: `settings`, `auth_user` and `auth_session` tables, `pnpm
  db:generate` / `pnpm db:migrate`, and migrations applied on start for `ROLE=api|all` under a
  Postgres advisory lock so concurrent containers cannot race. Settings secrets encrypt to
  `enc:v1:<ciphertext>` with AES-256-GCM, which refuses a wrong key rather than returning rubbish.
- `pnpm --filter <pkg> test` now runs that package's tests; previously every package's `test` script
  failed with "No projects were found" because the root Vitest `projects` globs resolved against the
  package directory rather than the workspace root.
- P0-04 Configuration and secrets: every process validates its environment through a Zod schema at
  startup and exits non-zero naming the variable that is wrong, listing all problems at once. A config
  object redacts the secret key, the database password and AI keys when logged.
- P0-03 CI workflow: Lint, Typecheck, Test, Build and Docker image run as separate parallel checks on every pull request, sharing a cached pnpm store through a composite setup action; pushes to `main` publish the image to GHCR as `edge` and `sha-<short sha>`.
- A minimal production `Dockerfile` (multi-stage, non-root, runs the API). Brought forward from P0-11 so CI has an image to build.
- Renovate configured for weekly grouped dependency updates, holding TypeScript on 6.x and Node on 24.
- Baseline pinned to Node 24 (Active LTS), pnpm 11, TypeScript 6.0, Vitest 4.1, Biome 2.5.
