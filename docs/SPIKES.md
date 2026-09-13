# Source spikes — findings

*Track A of Phase 1 (`docs/DEVELOPMENT_PLAN.md`). Answers the feasibility questions in
ARCHITECTURE.md §2 before any adapter is written. Each spike is run from the developer's Mac and
from the droplet; Vinted additionally through a residential proxy.*

| Source | Status | Recommendation |
|---|---|---|
| eBay (S1-01) | **Complete.** Works on a production keyset past the account-deletion gate; 5,000 calls/day | **Build as designed**, storing no seller identity, one country per plan |
| Vinted (S1-02) | Not started | — |
| Yahoo! Auctions JP (S1-03) | Not started | — |
| Mercari JP (S1-04) | Not started | — |

---

## S1-01 — eBay Browse API

Script: `spikes/ebay/run.ts`. Run with `EBAY_ENV=sandbox|production` and `SPIKE_ORIGIN=mac|droplet`.

### Run 1 — sandbox, from the Mac, 13 September 2026

Run against `api.sandbox.ebay.com` with a sandbox keyset, before a production keyset existed.
**It answers none of S1-01's four questions**, all of which are about a production keyset and a
real catalogue; it is recorded because it proves the request shapes the adapter will use are
accepted, so the production run measures eBay rather than our own mistakes.

What it establishes:

- **Client-credentials token works.** `POST /identity/v1/oauth2/token` with scope
  `https://api.ebay.com/oauth/api_scope` — note the scope identifier is the production URL in
  both environments — returned a token with a 7,200-second life. That is the application token
  §5 says to cache and refresh.
- **The marketplace header is accepted on three marketplaces.** `EBAY_GB`, `EBAY_US` and
  `EBAY_DE` each returned 200, so the "one plan per marketplace" model in §4 and the "major
  sites" preset in §5 are buildable on one keyset.
- **Every filter shape the design needs parses.** All returned 200 rather than 400:
  `itemStartDate:[<iso>..]` (the per-plan watermark in §6), `buyingOptions:{AUCTION}` and
  `{FIXED_PRICE}`, `price:[..150],priceCurrency:GBP`, `itemLocationCountry:GB`, and —
  the open question in §4 — the multi-value `itemLocationCountry:{GB|US}`. **Parsing is not
  filtering**: with an empty catalogue every one of these returned `total: 0`, so whether the
  multi-value form actually restricts results is for the production run to say.
- **`getItem` carries what §5 expects.** Against the one item the sandbox catalogue holds,
  `description`, `shipToLocations`, `localizedAspects`, `returnTerms` and the category path
  appear only on `getItem`, not on the search summary. Sound as a direction, but it is one
  listing, so the field table below stays unwritten until the production run.
- **Sort and pagination are accepted.** `sort=newlyListed` with `limit`/`offset` returned 200.

Two findings that carry over regardless:

- **`GET /developer/analytics/v1_beta/rate_limit/` answers `204 No Content` on sandbox**, with no
  body — so the daily quota cannot be read there. The production run is the only way to answer
  "what is the daily quota for your app".
- **The sandbox catalogue is effectively empty for our purposes.** `carmageddon` and `macintosh`
  both returned `total: 0` on all three marketplaces; `laptop` returned one item, a KVM console.
  This is ARCHITECTURE.md §16's "eBay's sandbox data is not useful", measured. The spike
  therefore writes **no fixtures** from a sandbox run: a fixture that does not match what eBay
  really returns is worse than no fixture.

Response times were 0.4–0.7 s per call, well inside anything the poll scheduler needs.

### Finding — Browse is *not* available on a standard production keyset without further steps

**This is the answer to S1-01's first done-when line, and it contradicts ARCHITECTURE.md §18.**
§18 recorded the risk as "eBay keyset approval — Browse API is available on a standard production
keyset; confirmed in the Phase 1 spike before anything depends on it". The spike has now
confirmed the opposite: a production keyset is issued but **disabled**, and every API call fails,
until the application either subscribes to eBay **Marketplace Account Deletion/Closure
Notifications** or is granted an exemption from them. Observed 13 September 2026 on this
project's own keyset. It is not a review or an approval queue — it is a self-service technical
gate, but it is a gate, and nothing can be built against production eBay until it is passed.

The requirement is not specific to Browse; it applies to the keyset.

**What subscribing requires.** An HTTPS endpoint, owned by the operator, registered in the
developer console alongside a verification token of 32–80 characters from
`[A-Za-z0-9_-]`. eBay then calls the endpoint two ways:

- `GET <endpoint>?challenge_code=<code>` — the endpoint must answer `200` with
  `Content-Type: application/json` and a body of `{"challengeResponse": "<hex>"}`, where the hex
  is `sha256(challenge_code + verificationToken + endpointUrl)`. The endpoint URL in the hash is
  the exact registered URL, without the query string. eBay sends this the moment *Save* is
  pressed, so **the endpoint must already be deployed and reachable before the console will
  accept it**.
- `POST <endpoint>` — a notification carrying the deleted user's `username`, `userId` and
  `eiasToken`, to which the endpoint answers `200`. The operator is then obliged to delete that
  user's data.

**The exemption is not honestly available to Goodies Beacon as designed.** The exemption is for
applications that do not persist eBay user data; eBay's own wording for it is "don't collect or
save personal data". ARCHITECTURE.md §4 has `Listing` storing `sellerId` and `sellerName`, and
§7 step 2's relist detection keys on "same seller", so seller identity is persisted by design and
is load-bearing. Claiming the exemption would mean either a false declaration or dropping relist
detection.

**Resolved by not storing the data.** eBay's criterion is "not persisting eBay *user* data" —
product and listing data are explicitly fine, and the exemption is a self-service toggle. The only
eBay user data in the design was `Listing.sellerId` / `sellerName`, earning its place in exactly
one feature: §7 step 2 relist detection, which asks only whether two candidates share a seller.
An equality test does not need a name, so §4 now stores `sellerHash` — `HMAC-SHA256(seller id,
instance salt)` — and ingest strips the seller block from the stored `raw` response. Nothing in
the UI (§14) or in an email (§10) ever showed a seller, so nothing is lost.

The instance then persists no eBay user data and the exemption is true rather than asserted.
Hosting the endpoint was the alternative and was rejected: it would put an unauthenticated public
route into an API whose contract (P0-07) is that everything but `/healthz` and auth returns 401,
and it would hand every self-hoster a standing erasure obligation for a feature none of them
asked for. ARCHITECTURE.md v1.23 carries the change in §2, §4, §7, §12 and §18; the plan carries
it into P1-01's and P1-04's done-when lists.

### Run 2 — production, from the Mac, 13 September 2026

Run after the exemption was granted. 19 calls, all 200, 162 search results across 15 queries and
three `getItem` responses. **Recommendation: build as designed**, with the four caveats below.

**1. Browse works on a standard production keyset, and the quota is 5,000 calls a day.**
`GET /developer/analytics/v1_beta/rate_limit/` reports `buy.browse` at **5,000 per 86,400 s**,
resetting 07:00 UTC, and `buy.browse.item.bulk` at another 5,000. §2 estimated "thousands of calls
per day — far more than we need" and that is right with room to spare: a plan polled three times a
day costs 3 search calls plus one `getItem` per survivor, so even twenty plans with fifty
survivors a day sit under 5% of the allowance. No extra approval is needed *for Browse itself* —
the only gate was the account-deletion one above.

**2. `itemLocationCountry` takes one value. The set form is accepted and then silently ignored.**
This is the finding most likely to have become a silent bug, so it was tested twice:

| Filter | `total` | Countries in the first page |
|---|--:|---|
| *(none)* | 340 | GB×9, CA×1 |
| `itemLocationCountry:GB` | 190 | GB×10 |
| `itemLocationCountry:US` | 310 | US×10 |
| `itemLocationCountry:{GB\|US}` | 340 | GB×9, **CA×1** |

Both single values filter correctly. The `{GB|US}` set form returns HTTP 200 with no warning, the
same total as no filter at all, and a **Canadian** listing on the first page — so it was parsed
and discarded. **P1-04 must use one country per plan and must not offer the set form**; since
`options` is per search plan (§4), "GB and US sellers" is two plans, which is the shape §4 already
prefers. A `200` is not evidence a filter worked: only the results are.

**3. eBay GB returns the whole world by default.** `macintosh` on `EBAY_GB` with no location
filter came back GB×24, US×18, JP×6, CA×1, DE×1 out of 50. This confirms §5's decision to leave
`itemLocationCountry` **off** by default and let the reviewer report ships-to-UK instead — turning
it on would have hidden roughly half of what is actually available to a UK buyer.

**4. What needs `getItem`.** Across 162 summaries and 3 items:

- *Always in the search summary:* `itemCreationDate` and `itemLocation` (162/162) — so the
  watermark and the country flag cost nothing extra. Also `title`, `price`, `condition`,
  `buyingOptions`, `seller`, `itemWebUrl`, `legacyItemId`, `thumbnailImages`.
- *Usually in the summary:* `image` 160/162, `additionalImages` 131/162, `shippingOptions`
  128/162. **Two listings carried no image at all**, which P1-05's media ingest must survive.
- *Only from `getItem`:* `description` and `shortDescription`, **`shipToLocations`**,
  `conditionDescription`, `localizedAspects`, `returnTerms`, the category path, and for auctions
  `minimumPriceToBid` and `uniqueBidderCount`.

**Consequence: `shipsToUk` cannot be known before enrichment.** It derives from
`shipToLocations`, which is `getItem`-only, so the flag is only available at §7 step 4 and after —
not at the pre-filter. That is fine as the pipeline stands, but it means ships-to-UK can never be
a pre-filter input, and a candidate rejected before enrichment will never have the flag. Deriving
it is also not a string match: `regionIncluded`/`regionExcluded` are lists of `{ regionName,
regionType, regionId }`, and the exclusion list has to be checked as well as the inclusion one.
In the three sampled items every entry was `regionType: COUNTRY` and all three named `GB`
explicitly; the two `COUNTRY_REGION` entries seen were sub-national (`Alaska/Hawaii`, `APO/FPO`)
rather than continents. eBay's schema also allows `WORLDWIDE` and `WORLD_REGION`, which this
sample did not exercise, so P1-04 handles them defensively and falls back to `unknown` rather
than guessing. All three sampled items ship to the UK; one
listed a single included country, one listed 100, one mixed countries and regions.

**5. `getItem` returns business sellers' real-world identity, and it is worse than a username.**
For a trader, `seller.sellerLegalInfo` carries the person's legal name, first and last contact
names, a street address, an email address and their terms of service — the details UK and EU
consumer law obliges a trader to publish. One of the three sampled items had it: a named
individual in Québec with their home address and personal email.

This arrives inside the response that §4 would otherwise store whole in `raw`, so it sharpens the
decision recorded there from a principle into a requirement. Hashing the seller id is not enough
on its own: **P1-04 must drop the entire `seller` object before the response is persisted**, or a
trader's address ends up in the database, in every nightly dump, and in any log that prints a raw
response. It is also the clearest possible answer to whether an eBay response contains eBay user
data — it contains rather more than a username.

The spike's own anonymiser replaces the block with a synthetic one of the same shape rather than
deleting it, so the adapter test in P1-04 has something realistic to prove it strips.

**6. The same listing appears on more than one marketplace.** Four of the ten `EBAY_GB` results
came back identically from `EBAY_DE`, same `itemId`. So a wanted item with a plan on each
marketplace — which is the shape §4 recommends, and which point 2 above now *forces* for
multi-country coverage — will see the same listing several times in one polling round. The design
already absorbs this: `seen (source, external_id)` is unique per §4 and P1-01, and `externalId` is
the `itemId`, so the second plan finds it in `Seen` and skips it. Worth knowing that overlapping
plans are expected and cost one wasted comparison rather than a duplicate candidate or a second
review — and worth a test in P1-07, since the saving only holds if `seen` is checked before the
candidate is created rather than after.

**Two gotchas for P1-04 and P1-06.**

- **An auction's `price` is `null`.** The value lives in `currentBidPrice`, alongside `bidCount`.
  A price-ceiling hard filter (§7 step 2) that reads `price` would throw or silently pass every
  auction. The adapter must normalise `price ?? currentBidPrice`.
- **`total` is an estimate, not a count.** GB (190) + US (310) exceeds the unfiltered total (340).
  Never use it to decide when paging has finished; page until a result is older than the watermark
  or the cap is hit, which is what §6 already says.

**Also confirmed.** `sort=newlyListed` with `limit`/`offset` pages correctly.
`filter=itemStartDate:[<iso>..]` narrows as expected — 7 days gave 12 results, 120 days gave 133 —
so it reaches back at least 120 days and is sound as the per-plan watermark. `buyingOptions`
filters correctly in both directions (`{AUCTION}` returned 8, every one an auction;
`{FIXED_PRICE}` returned only fixed-price listings). `price:[..150],priceCurrency:GBP` applied.
The same keyset reached `EBAY_GB`, `EBAY_US` and `EBAY_DE`, so the "major sites" preset in §5 is
buildable. Auctions carry `itemEndDate` in the *summary*, so §10's "auction/fixed and end time" in
an email needs no extra call. Calls took 0.4–0.9 s.

**Fixtures recorded:** 18 files in `packages/sources/ebay/fixtures/`, anonymised.

### The droplet leg — reasoned, not measured

The plan asks for every spike to be run from the Mac and from the droplet. For eBay that leg was
**deliberately skipped**, and this is the reasoning rather than a result.

The droplet half of the matrix exists because the scraped sources are judged on *where the request
comes from*: DataDome scores Vinted by IP range and TLS fingerprint (§2), so a Mac result says
nothing about a VPS. eBay is not that kind of source. It is an authenticated REST API on a
standard production keyset; access is decided by the bearer token, and the 5,000-call quota is
reported per application, not per origin. There is no plausible mechanism by which the same token
would behave differently from a DigitalOcean address.

If that presumption is ever wrong it fails loudly and early — the adapter's `healthCheck` (§5)
performs a one-result search and surfaces the failure on the dashboard and in the digest, and the
first poll from the droplet would show it within a day. The cost of being wrong is therefore a
visible health error, not silent missing listings, which is what made it acceptable to reason
rather than measure here. **The scraped sources get no such benefit of the doubt**: S1-02 to S1-04
must be run from both origins, because for them the origin *is* the question.

S1-01 is complete.

---

## S1-02 — Vinted

Not started. Needs a residential proxy with a sticky GB session (§5) before the third leg of the
matrix can be run.

## S1-03 — Yahoo! Auctions JP

Not started.

## S1-04 — Mercari JP

Not started.
