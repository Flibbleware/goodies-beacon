/**
 * Pre-filter prompt — ARCHITECTURE.md §7 step 3.
 *
 * ## Changelog
 *
 * - **v1** — 14 September 2026, P1-09. First version. Written to be *reluctant to reject*: this
 *   stage runs on every new listing on the cheapest model available, and its whole job is to stop
 *   obvious rubbish reaching the vision model. A wrong rejection here is invisible — the listing
 *   is never reviewed, never emailed, and nobody finds out — while a wrong acceptance costs a
 *   fraction of a penny and is caught by the reviewer a moment later. So the instructions say to
 *   keep anything uncertain, and the examples are all of things that are *clearly* something else.
 */

export const PREFILTER_PROMPT_VERSION = 'prefilter.v1';

/**
 * The system prompt. Stable for every listing of every item, so it is the first thing in the
 * request and the part a provider's prefix cache can hold (§9).
 */
export const PREFILTER_SYSTEM = `You are the first, cheapest stage of a collector's wanted-list pipeline. A search has returned a marketplace listing and you decide one thing: could this plausibly be the item the collector is looking for, or is it clearly something else?

You are a filter, not a judge. A later stage looks at the photographs and decides properly, against the full criteria. Your only job is to stop obvious rubbish reaching it.

Answer "plausible: true" unless the listing is clearly not the thing. In particular:
- Uncertain is plausible. If the title is vague, the description is thin, or you cannot tell the edition, variant, platform or condition — say plausible and let the reviewer look at the photographs.
- Missing information is not evidence against. Sellers write poor titles and omit model numbers, editions and platforms constantly. Absence of a detail is not absence of the item.
- Judge the item, not its condition or completeness. A damaged, incomplete or untested example of the right thing is plausible; deciding whether it is good enough is the reviewer's job, and the collector may want it anyway.
- Do not apply price, postage, location or seller judgements. Those are handled elsewhere and are none of your business.

Answer "plausible: false" only when the listing is clearly a different thing. Typical cases:
- Merchandise or media about the item rather than the item: a t-shirt, poster, mug, soundtrack, sticker, art print, or a magazine that reviewed it.
- A different product that merely shares a word with it, or the same title on a platform or in a format the collector did not ask for when the spec is explicit about that.
- A part, accessory, replacement manual, empty box or spare disc, when the collector wants the complete item.
- An item that is plainly not for sale as described: a wanted advert, a bundle in which the item is a minor extra, or an obvious counterfeit or reproduction the spec excludes.

Give a reason of one short sentence, in plain English, saying what decided it. For a rejection, name the thing it actually is ("this is a t-shirt, not the game"). For an acceptance, say what makes it plausible, or say that there is too little information to tell — which is itself a good reason to keep it.`;

/** What the model is shown about one listing, with the spec it is being judged against. */
export interface PrefilterPromptInput {
  /** The wanted item's summary from its current spec version (§4). */
  specSummary: string;
  /** The interviewer's per-item note about how sellers title this thing (§7 step 3, §8). */
  plausibilityNote: string | null;
  /** Criterion text only: the pre-filter is text-only and cheap, and does not judge criteria. */
  criteriaTitles: readonly string[];
  listingTitle: string;
  /** Already truncated by `boundDescription`. */
  listingDescription: string | null;
}

/**
 * The per-listing half of the prompt.
 *
 * Ordered with the spec first and the listing last for the same reason the review prompt is (§9):
 * everything above the listing is identical for every candidate of an item, so a provider that
 * caches prompt prefixes charges a fraction for it from the second listing onwards.
 */
export function buildPrefilterPrompt(input: PrefilterPromptInput): string {
  const sections = [
    `# What the collector wants\n\n${input.specSummary.trim() || '(no summary written)'}`,
  ];

  if (input.plausibilityNote?.trim()) {
    sections.push(
      `# How sellers list this, from the collector\n\n${input.plausibilityNote.trim()}`,
    );
  }

  if (input.criteriaTitles.length > 0) {
    // Titles only, and labelled as context: the reviewer judges these, and a cheap text model
    // asked to apply them would reject on a criterion the photographs would have settled.
    const list = input.criteriaTitles.map((title) => `- ${title}`).join('\n');
    sections.push(
      `# What the reviewer will check later\n\nContext only — do not apply these yourself.\n\n${list}`,
    );
  }

  const description = input.listingDescription?.trim();
  sections.push(
    `# The listing\n\nTitle: ${input.listingTitle.trim()}\n\n${
      description ? `Description:\n${description}` : 'Description: (none given)'
    }`,
  );

  return sections.join('\n\n');
}
