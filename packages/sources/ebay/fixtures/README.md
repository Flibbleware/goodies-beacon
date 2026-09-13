# eBay fixtures

Real Browse API responses, recorded by `spikes/ebay/run.ts` (S1-01) and anonymised: seller
usernames are replaced with stable pseudonyms (`seller_001`), partial postcodes and affiliate
URLs are dropped, and anything that looks like an email address or a phone number in free text is
redacted. Pseudonyms are stable within a recording, so two listings by one seller are still two
listings by one seller — the relist detection in ARCHITECTURE.md §7 keys on that.

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
| `item-1`, `item-2`, `item-3` | `getItem`: description HTML, full images, `shipToLocations` |

Re-record them by running the spike again. Do not hand-edit: a fixture that no longer matches
what eBay returns is worse than no fixture.
