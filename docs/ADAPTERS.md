# Writing a source adapter

*First draft, from P1-03. Companion to ARCHITECTURE.md §5, which is the contract's reference.*

A source adapter is the only thing that knows how one marketplace works. Everything else in
Goodies Beacon — the scheduler, the pipeline, the reviewer, the emails — is written against the
interface below, so adding a marketplace is one package and a break in one is a one-file fix.

## Start from the template

`packages/sources/_template` is a working adapter for a marketplace that does not exist. It is
not a stub: it implements every method, is exercised by the fixture harness, and demonstrates the
three things that are easy to get wrong. Copy the directory, rename the package, and replace the
parsing.

```
packages/sources/<id>/
  package.json          name: @goodies-beacon/source-<id>
  fixtures/             recorded responses, anonymised, committed
  src/index.ts          the adapter
  src/index.test.ts     the harness tests
```

Add the id to `MARKETPLACE_SOURCE_IDS` in `packages/core/src/sources.ts`. That list is what gets a
`poll.<id>` queue, a Settings section and a place in `WORKER_SOURCES`; `SOURCE_IDS` is the wider
list of values a `source` column will accept, and already includes the template.

## The contract

```ts
export interface SourceAdapter {
  readonly id: SourceId;
  readonly displayName: string;
  readonly requiresBrowser: boolean;
  readonly recommendedMinInterval: string;   // ISO 8601, e.g. PT8H
  readonly credentialSchema: z.ZodType;

  healthCheck(ctx: AdapterContext): Promise<HealthResult>;
  describeSearchOptions(): SearchOptionSchema;
  search(plan: SearchPlan, request: SearchRequest, ctx: AdapterContext): Promise<RawListing[]>;
  enrich(listing: RawListing, ctx: AdapterContext): Promise<EnrichedListing>;
}
```

**Adapters never touch the database.** Everything arrives on the `AdapterContext`:

| | |
|---|---|
| `ctx.http` | Rate-limited client: per-source concurrency, jittered spacing, proxy, timeouts |
| `ctx.cookies` | A jar persisted in the database, keyed by source and domain |
| `ctx.browser` | A Playwright page factory, or `null` in a process without a browser |
| `ctx.credentials` | Validated against your `credentialSchema` before you see it |
| `ctx.logger` | Structured; a poll's logs carry its ids |
| `ctx.signal` | Aborted on SIGTERM, so a long poll does not hold up shutdown |

That is what makes an adapter testable without a network, and it is why `ctx.http` exists rather
than `fetch`: spacing and politeness are the client's business, not something four adapters each
have to remember and one of them gets wrong.

## Three things that are easy to get wrong

**Normalise the price.** An auction may report no price at all, with the figure under a different
name — eBay puts it in `currentBidPrice` and leaves `price` null (S1-01). An adapter that reads
only `price` hands the price-ceiling hard filter a null on every auction it ever sees.

```ts
const money = item.price ?? item.currentBid ?? null;
```

**Hash the seller, and drop everything else about them.** Goodies Beacon stores no marketplace
user data (§4). Relist detection only asks "is this the same seller as before", which is an
equality test, so a keyed hash serves it. Strip the whole seller object before putting anything
in `raw`: eBay returns a business seller's legal name, street address and email in
`seller.sellerLegalInfo`, and `raw` is stored verbatim and appears in every nightly dump.

```ts
const { seller, ...rest } = item;
return { ..., sellerHash: sellerHash(SOURCE, seller.handle, salt), raw: rest };
```

**Stop at the watermark, do not filter afterwards.** Results come newest-first, so the first
listing older than `request.since` means the rest are older still. Returning early saves the
requests that would have fetched listings you then throw away.

**Honour `request.until` as well as `request.since`.** It is a ceiling on `listedAt`, exclusive,
and it is set only when the previous run stopped at the cap. Because results come newest-first, a
capped run takes the newest N and leaves the rest of its window unreached; without the ceiling the
next run would fetch the same newest N again and the gap would never be reached (§6). Pass it to
the source if it has a range filter — eBay's `itemStartDate` takes `[since..until]` — and drop
anything at or above it either way, so the last run's oldest listing is not ingested twice.

## Search options and regions

`describeSearchOptions()` is how the UI and the interviewer learn what your source supports,
so neither hard-codes a marketplace list. Regions are in the source's own vocabulary —
`EBAY_GB`, `vinted.co.uk`, `jp` — because a region belongs to a search plan, not to the item.

A filter that the source accepts but ignores is worse than one it rejects. eBay returns HTTP 200
for `itemLocationCountry:{GB|US}` and then ignores it (S1-01), so the adapter never generates that
form. If you are unsure whether a filter works, compare result counts against an unfiltered
baseline; a 200 proves only that the syntax parsed.

## Health

`healthCheck` is the Settings "Test" button and the dashboard's source status. Return the status
that tells the operator what to do:

- `ok` — working.
- `degraded` — working, but something is worth saying (quota nearly spent).
- `blocked` — the source is refusing us. Say what would fix it: *"blocked — run this worker from a
  residential connection or configure a proxy"*.
- `error` — credentials, or something unexpected.

## Testing with the harness

Adapter tests run offline, without credentials, in a fork's CI. The harness replays recorded
fixtures and validates what your adapter returns against `rawListingSchema`, so an adapter that
parses a page but produces something the pipeline cannot store fails in its own tests rather than
three stages later in a poll.

```ts
const test = createHarness({
  adapter: myAdapter,
  fixturesDir: fileURLToPath(new URL('../fixtures', import.meta.url)),
  routes: [
    { match: '/search', fixture: 'search.json' },
    { match: '/listing/', fixture: 'item.json' },
  ],
});

const listings = await test.search(plan, { since: watermark });
expect(test.requests[0]).toContain('sort=newest');
```

A request with no matching route throws `UnmatchedRequestError` naming the URL, rather than
quietly returning nothing — a missing recording should fail, not produce a passing test that
proves nothing.

Cover at least what P1-04 asks of the eBay adapter: new listings since the watermark, an empty
result, a pagination stop, ships-to-UK derived as yes/no/unknown, price and currency captured, and
auction versus fixed detected.

## Recording fixtures

Fixtures are real responses, committed, so they must carry nothing identifying. Anonymise before
saving: remap listing ids and URLs so nothing resolves to a live listing, pseudonymise seller
handles *consistently* (two listings by one seller must stay two listings by one seller, or relist
detection is untestable), and drop legal-info blocks, precise locations and feedback scores.
`spikes/ebay/anonymise.ts` is a worked example.

Do not hand-edit a fixture. One that no longer matches what the source returns is worse than none.

## Browsers and proxies

Set `requiresBrowser` if you need one, and expect `ctx.browser` to be `null` in a process that has
none — the slim image has no Chromium. The factory runs one browser at a time and blocks images,
fonts and media, because a listing page's photographs are most of its weight and none of its
content.

Each source can be given a proxy URL in Settings. It is applied to both the HTTP client and the
browser, so they leave by the same address; you do not need to do anything for it to work.
