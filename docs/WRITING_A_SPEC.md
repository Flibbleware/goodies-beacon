# Writing a wanted item's spec

A self-contained brief for writing the JSON spec of a Goodies Beacon wanted item — for a person,
or for an AI session given this file and nothing else. It is the compact form of what
ARCHITECTURE.md §4, §7 and §8 say about specs, plus what building and testing the pipeline has
taught; where the two disagree, ARCHITECTURE.md and `packages/core/src/domain/spec.ts` win and this
file is out of date.

Until the interviewer (Phase 3) exists, this is how a spec gets written.

## How to use it with an AI

Give a fresh session this whole file and a description of the thing, then iterate. For example:

> You are helping me write the spec for a wanted item in Goodies Beacon. The attached
> WRITING_A_SPEC.md is everything you need to know about the format and the rules; follow it
> exactly. The item: *a boxed Nintendo Game Boy DMG-01, PAL, complete with box, inner tray and
> manual; working; under £150; UK and US eBay.*
>
> Before writing anything, ask me whatever you need to settle — completeness, condition tolerance,
> look-alikes to exclude, price, marketplaces — a few questions at a time. Then give me: the title
> and summary for the Create dialog, and the JSON to paste into the item's JSON editor. After the
> JSON, list the checklist at the end of the brief with each line ticked or explained.

Ask it to interview you first: a spec written from one sentence guesses at exactly the things the
reviewer will later trip on — which variants count, what "complete" means, what damage is fatal.

## Where the result goes

1. **Wanted Items → Create.** Give the *title* (what you call it), a *category*, and the *summary*
   (below). This makes a draft, version 1.
2. On the item's page, **JSON** → replace the document with the spec → **Save**. That is version 2.
3. Upload reference photos through **Reference Images** (they cannot be written into JSON — each
   entry points at an uploaded file). Optional.
4. **Start Polling** once the red marks are gone: at least one criterion, and one enabled search
   plan on a marketplace switched on in the settings.

The title and category are the item's, not the spec's, so they are not in the JSON.

## What the spec is for

Every new listing a search plan finds goes through four stages, cheapest first:

1. **Hard filters, in code.** Over the price ceiling → rejected. A negative keyword in the title →
   rejected. No model is called.
2. **Pre-filter, a cheap text-only model.** Given the listing's title and the start of its
   description, the **summary**, the **how sellers list this** note, and the criteria's text —
   told *not* to apply them. Its only job is to throw out the obvious rubbish (a t-shirt, the
   wrong game); anything plausible or unclear goes through. It fails open: a wrongly discarded
   listing is never seen again, so it is built to be reluctant.
3. **Reviewer, a vision model.** Given the **summary**, every **criterion** with its flags, the
   **reference images** with their labels, and the listing's photos and full description. It
   answers each criterion `pass`, `fail` or `unknown` with a line of evidence. It never sees the
   plausibility note, and it never gives a verdict.
4. **Decision, in code**, from the reviewer's answers:

   | reviewer said | criterion is | result |
   |---|---|---|
   | fail | hard | **reject** |
   | fail | soft | **uncertain** |
   | unknown | `onUnknown: surface` | **uncertain** |
   | unknown | `onUnknown: reject` | **reject** |
   | nothing failed or unknown | | **match** |

   Every rule is applied and the worst outcome wins. Matches and uncertains are emailed; rejects
   are kept, with evidence, for auditing.

So: **only criteria can reject a listing the filters let through**, and a spec with no criteria
matches almost everything. The summary is context; the criteria are the test.

## The document

```jsonc
{
  "summary": "…",
  "plausibilityNote": "…" | null,
  "settings": { … },
  "criteria": [ … ],
  "searchPlans": [ … ],
  "referenceImages": [],
  "changeNote": "…" | null
}
```

### `summary`

One or two sentences: what the thing is, which variants are acceptable, and what it must not be
confused with. Both models read it. Required by the Create dialog.

> Carmageddon, the original 1997 big-box release. Macintosh preferred, PC acceptable. Box, manual
> and disc all present; not the jewel-case re-release, not Carmageddon 2, not the Splat Pack
> expansion.

### `plausibilityNote` — "How sellers list this"

Written for the pre-filter alone: how sellers actually title these listings, what is plausible
though it does not look it, and what plainly is not. It matters most when the name is a common
phrase or sellers leave out the model number. `null` if there is nothing to say.

> Sellers title these inconsistently and often omit the platform: 'Carmageddon PC CD-ROM big box',
> 'Carmageddon Mac', or just 'Carmageddon' with a photo of the box. Treat any 1990s boxed copy as
> plausible and let the reviewer sort the edition out. A listing that is clearly a t-shirt, a
> soundtrack or a Nintendo 64 cartridge is not.

### `settings`

Everything with a fixed set of values. **Never express one of these as a criterion** — "under
£150", "UK sellers only", "auction only" belong here, where they are exact and free, not in front
of a model.

| field | values | today |
|---|---|---|
| `sources` | `["ebay"]` | Only eBay has an adapter until Phase 4. A plan whose source is not listed here is not polled. |
| `priceCeiling` | `{ "amount": 120, "currency": "GBP" }` or `null` | **Enforced.** GBP only; other currencies are converted first. `null` is any price. |
| `negativeKeywords` | `["t-shirt", "poster"]` | **Enforced.** A title containing one (ignoring case, anywhere in the title) is rejected with no model called. Free but blunt: `"n64"` also matches inside a longer word, and a word that can appear in a listing you want loses it silently. Use distinctive words only. |
| `notificationMode` | `"realtime"` or `"digest"` | **Enforced.** Real-time emails each match; digest sends one email at 08:00. |
| `pollEvery` | `"PT8H"`, `"PT12H"`, `"P1D"`, or `null` | **Enforced.** ISO 8601; the settings editor takes hours. `null` is the default, every 8 hours. Rounded up to 1, 2, 3, 4, 6, 8, 12 or 24 hours. |
| `defaultOnUnknown` | `"surface"` or `"reject"` | Stored; every criterion carries its own `onUnknown`, which is what is used. Leave `"surface"`. |
| `listingTypes` | `["auction", "fixed"]` | **Not yet acted on.** At least one. Leave both. |
| `conditionCategory` | `"any"`, `"new"`, `"used"`, `"for_parts"` | **Not yet acted on.** Leave `"any"` and put condition in the criteria. |
| `shipsToUk` | `"show_all"`, `"flag"`, `"only"` | **Not yet acted on**; every listing is shown with its ships-to-UK flag. Leave `"show_all"`. |
| `relists` | `"show"`, `"suppress"` | **Not yet acted on.** Leave `"show"`. |
| `backfill` | `{ "enabled": false, "depth": "top_200" }` | **Not yet acted on**; depth is `top_50`, `top_200` or `last_30_days`. |
| `gradingScaleId`, `minimumGrade` | `null` | Grading arrives in Phase 5. Always `null`. |

### `criteria`

The judgement calls: things that need the description read or the photos looked at. Each is:

```json
{
  "id": "big-box",
  "text": "Big box release, not the jewel case or budget re-release",
  "kind": "hard",
  "quantifiable": true,
  "onUnknown": "surface"
}
```

- **`id`** — short, lowercase, hyphenated, unique within the spec (`contents-complete`). It is kept
  across versions so feedback stays attached: when revising a spec, keep a criterion's id unless
  its meaning changes.
- **`text`** — one testable statement of what must be true, phrased so it *passes* for the listing
  you want.
- **`kind`** — `hard`: a fail rejects. `soft`: a fail makes it uncertain, so you still see it.
  Use `hard` for identity (the wrong game, the wrong model) and `soft` for condition and
  completeness, where you might still want to decide yourself.
- **`quantifiable`** — can photos or text settle it definitively? "Big box, not jewel case" can be
  seen. "The disc reads" cannot. `hard` with `quantifiable: false` is legal but flagged: it rejects
  on a blurry photo as readily as on a real fault, and `soft` is almost always what is meant.
- **`onUnknown`** — what happens when the listing does not show or say. `surface` (the default)
  makes it uncertain; `reject` drops it. Use `reject` only where a listing that does not settle the
  question is not worth seeing — typically identity: `first-game` in the example rejects a listing
  that cannot be told apart from the sequel.

**Rules the tests taught the hard way:**

- **One test per criterion.** "No burn-in, cracks or discolouration" is three tests; when a seller
  answers one, the reviewer cannot pass or fail the whole cleanly, and different models disagree.
  Split it.
- **Do not bundle form with completeness.** "A complete all-in-one machine" mixes what it is with
  what is present, and a partial listing cannot be judged against it. Two criteria.
- **Avoid visual verbs.** "The disc *looks* free of scratches" makes a seller's plain statement
  inadmissible, since there is no photo to look at; "The disc is free of deep scratches" lets
  either settle it.
- **No prices, countries, listing types or conditions-as-categories** — those are settings.
- **Two to six criteria** is typical. More is fine; each one is another thing a listing must show.

### `searchPlans`

What to search for. **Search broad, judge narrow**: several loose queries rather than one precise
one, because sellers title things inconsistently and the pre-filter and reviewer do the narrowing.

```json
{
  "id": "gameboy-dmg-ebay-gb-game-boy",
  "source": "ebay",
  "query": "game boy dmg-01",
  "region": "EBAY_GB",
  "options": {},
  "enabled": true,
  "watermark": null
}
```

- **`id`** — **unique across every item on the instance**, not just this spec: a plan's watermark
  and stats are keyed on the id alone, so two items sharing one would share a watermark. Prefix it
  with something particular to this item. Keep it across versions, since its stats hang off it.
- **`source`** — `"ebay"`.
- **`query`** — as typed into eBay's search box. Include the head term alone ("carmageddon"), the
  common ways sellers write it, variants that omit the model number, and misspellings sellers
  really use.
- **`region`** — one eBay site per plan: `EBAY_GB`, `EBAY_US`, `EBAY_DE`, `EBAY_FR`, `EBAY_IT`,
  `EBAY_ES`, `EBAY_AU`, `EBAY_CA`, `EBAY_IE`. Each site returns listings from the whole world, so
  `EBAY_GB` alone already reaches many foreign sellers; add `EBAY_US` for US-market items.
- **`options`** — usually `{}`. Two are honoured:
  - `"itemLocationCountry": "GB"` — only sellers located in one country. **One code only**: eBay
    accepts a set and silently ignores it, so two countries means two plans. Off by default, since
    ships-to-UK is reported on every listing anyway.
  - `"conditions": ["USED"]` — `NEW`, `USED`, `UNSPECIFIED`. Rarely worth it: sellers mislabel.
- **`enabled`** — `false` pauses a plan without deleting it. **`watermark`** — always `null`.

Every query runs every poll, so each costs pre-filter calls on everything it finds: three to six
plans is typical.

### `referenceImages`, `changeNote`, `createdBy`

`referenceImages` is `[]` — photos are uploaded on the item page. `changeNote` and `createdBy` can
be left out: the JSON editor records its own *Change note* field as the version's note ("Edited the
JSON." when left empty), whatever the document says.

## Before pasting — checklist

- [ ] Nothing bounded (price, country, auction/fixed, new/used) is a criterion.
- [ ] Every criterion is one test, passes for what is wanted, and uses no visual verb.
- [ ] Identity criteria are `hard`; condition and completeness are `soft`.
- [ ] No criterion is `hard` with `quantifiable: false` unless that is truly meant.
- [ ] `onUnknown: "reject"` only where a listing that does not settle it is not worth seeing.
- [ ] At least one criterion and one enabled `ebay` plan, with `"ebay"` in `settings.sources`.
- [ ] Plan ids are particular to this item; criterion ids are unique within it.
- [ ] Several broad queries, not one precise one; `region` is one eBay site per plan.
- [ ] Negative keywords are distinctive words that no wanted listing would contain.
- [ ] `gradingScaleId` and `minimumGrade` are `null`; `referenceImages` is `[]`.

## A complete example

`packages/core/src/domain/fixtures/carmageddon.json` and `power-mac-5500.json` are the two worked
examples the tests use. This is the first, with its plans given ids particular to the item as the
brief asks (the fixture's are older and generic) and backfill off, since nothing acts on it yet:

```json
{
  "summary": "Carmageddon, the original 1997 big-box release. Macintosh preferred, PC acceptable. Box, manual and disc all present; not the jewel-case re-release, not Carmageddon 2, not the Splat Pack expansion.",
  "plausibilityNote": "Sellers title these inconsistently and often omit the platform: 'Carmageddon PC CD-ROM big box', 'Carmageddon Mac', or just 'Carmageddon' with a photo of the box. Treat any 1990s boxed copy as plausible and let the reviewer sort the edition out. A listing that is clearly a t-shirt, a soundtrack or a Nintendo 64 cartridge is not.",
  "settings": {
    "sources": ["ebay"],
    "listingTypes": ["auction", "fixed"],
    "priceCeiling": { "amount": 120, "currency": "GBP" },
    "shipsToUk": "show_all",
    "conditionCategory": "any",
    "gradingScaleId": null,
    "minimumGrade": null,
    "negativeKeywords": ["t-shirt", "poster", "soundtrack", "nintendo 64", "n64"],
    "notificationMode": "realtime",
    "pollEvery": null,
    "relists": "show",
    "defaultOnUnknown": "surface",
    "backfill": { "enabled": false, "depth": "top_200" }
  },
  "criteria": [
    { "id": "big-box", "text": "Big box release, not the jewel case or budget re-release", "kind": "hard", "quantifiable": true, "onUnknown": "surface" },
    { "id": "first-game", "text": "The first Carmageddon, not Carmageddon 2, TDR 2000, or the Splat Pack expansion", "kind": "hard", "quantifiable": true, "onUnknown": "reject" },
    { "id": "contents-complete", "text": "Box, manual and disc are all present", "kind": "soft", "quantifiable": true, "onUnknown": "surface" },
    { "id": "no-water-damage", "text": "No water damage, mould or heavy crushing to the box", "kind": "soft", "quantifiable": true, "onUnknown": "surface" },
    { "id": "disc-readable", "text": "The disc is free of deep scratches that would stop it reading", "kind": "soft", "quantifiable": false, "onUnknown": "surface" }
  ],
  "searchPlans": [
    { "id": "carmageddon-ebay-gb", "source": "ebay", "query": "carmageddon", "region": "EBAY_GB", "options": {}, "enabled": true, "watermark": null },
    { "id": "carmageddon-ebay-us", "source": "ebay", "query": "carmageddon", "region": "EBAY_US", "options": {}, "enabled": true, "watermark": null },
    { "id": "carmageddon-ebay-gb-big-box", "source": "ebay", "query": "carmageddon big box", "region": "EBAY_GB", "options": {}, "enabled": true, "watermark": null }
  ],
  "referenceImages": []
}
```
