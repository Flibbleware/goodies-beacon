# eBay fixtures

Real Browse API responses, recorded by `spikes/ebay/run.ts` (S1-01), then anonymised so that
nothing in them resolves to a real listing or a real person.

**Why that goes further than removing usernames.** A recorded response carries the live `itemId`
and listing URL, and anyone can open those and read the seller's name straight off eBay — so a
pseudonymised username alone is a lock with the key beside it. These files are committed to a
repository meant to go public, and an instance claims eBay's "not persisting eBay user data"
exemption (ARCHITECTURE.md §2), so the repository must not quietly become the place that data
lives instead. What the anonymiser does:

- **Identifiers are remapped, not kept.** `itemId`, `legacyItemId` and `itemGroupId` become
  synthetic numbers of the same length beginning `9`, and the replacement is applied across the
  whole document — so `itemHref`, `itemWebUrl` and the `next`/`prev` links move with them,
  percent-encoded or not. One real listing maps to one synthetic id *across every fixture*, so
  the four listings that appear on both `EBAY_GB` and `EBAY_DE` still look like one listing seen
  twice, which is what a dedupe test needs.
- **Seller identity is reduced to a stable pseudonym** (`seller_001`). Stable within the
  recording, so two listings by one seller stay two listings by one seller — relist detection
  (§7 step 2) keys on exactly that.
- **`sellerLegalInfo` is replaced wholesale** with a synthetic block of the same shape. eBay
  returns a business seller's legal name, street address and email there; the shape is kept so
  P1-04 can prove it strips the object before storage.
- **Dropped:** `feedbackScore`, `feedbackPercentage` (precise enough to single a seller out),
  `itemLocation.city` and `stateOrProvince` (a person's town — only `country` is ever read),
  postcodes and affiliate URLs.
- **Descriptions are replaced** with synthetic HTML. One sampled listing volunteered that its
  seller is a full-time student who ships on Mondays and Thursdays; the adapter only needs the
  field to be a non-empty HTML string.
- **Image URLs are remapped** to `Fixture001…`, so no stored photo is fetched by a test.

Query strings are stripped from listing URLs, taking eBay's `amdata` tracking blob with them.

They are committed so the adapter tests in P1-04 and the harness in P1-03 run offline, without
credentials, in a fork's CI.

| Fixture | What it is there for |
|---|---|
| `gb-baseline`, `us-baseline`, `de-baseline` | The same query on three marketplaces |
| `gb-since-watermark`, `gb-since-far-past` | `itemStartDate`, which is the per-plan watermark (§6) |
| `gb-auction-only`, `gb-fixed-only` | `buyingOptions`, for `settings.listingTypes` |
| `gb-price-ceiling` | `price` + `priceCurrency`, for `settings.priceCeiling` |
| `gb-location-single`, `gb-location-multi` | Whether `itemLocationCountry` takes one value or several |
| `gb-broad-macintosh` | A broad query — the pre-filter's real workload |
| `gb-empty-result` | An empty result, which the harness needs |
| `gb-page-1`, `gb-page-2` | Pagination, so a pagination stop can be tested |
| `gb-location-us` | A second single-value location filter, proving the filter works before judging the set form |
| `item-1`, `item-2`, `item-3` | `getItem`: description HTML, full images, `shipToLocations`, `sellerLegalInfo` |

Re-record them by running the spike again. Do not hand-edit: a fixture that no longer matches
what eBay returns is worse than no fixture.
