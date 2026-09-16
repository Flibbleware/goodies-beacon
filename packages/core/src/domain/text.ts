/**
 * Turning a marketplace description into text, at ingest (§7 step 1, "text cleaned").
 *
 * eBay's `getItem` returns the seller's description as a full HTML document, and §12 requires it
 * to be sanitised before it is stored: it is a stranger's markup, it ends up in the database, in
 * every nightly dump, and on the candidate page. It also ends up in the *prompt*, where the
 * reviewer's character budget is spent on `<font face="Arial" size="3">` instead of on what the
 * seller actually wrote — so cleaning it is worth doing for the review as well as for the page.
 *
 * **Text, not sanitised HTML, and that is a deliberate reading of §12** — which allows either.
 * Sanitised HTML would mean DOMPurify, which server-side means jsdom: ten megabytes of dependency
 * in an image §11 budgets at 400 MB slim, to keep a seller's `<table>` layout. Text has no
 * dependency, and it is safe by construction rather than by trusting a filter — the UI renders it
 * through React as a string, so there is no markup left to escape and no path to execute
 * anything. What is lost is a seller's formatting, which is rarely the reason anyone reads one.
 */

/** Long enough for any real description; a defence against a pathological one, not a feature. */
export const DESCRIPTION_LIMIT = 40_000;

/** Elements whose *contents* are code or styling rather than prose, and must go with the tag. */
const DROPPED_CONTENT = /<(script|style|noscript|iframe|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** Block-level tags that end a line, so paragraphs and list items survive as line breaks. */
const BREAKS = /<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/blockquote)\b[^>]*>/gi;

const TAGS = /<[^>]*>/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  pound: '£',
  euro: '€',
  yen: '¥',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  bull: '•',
  middot: '·',
  deg: '°',
  copy: '©',
  reg: '®',
  trade: '™',
};

/**
 * HTML to plain text, keeping the line structure a reader needs.
 *
 * Entities are decoded *after* the tags are stripped and never re-examined, which is the ordering
 * that matters: decoding first would let `&lt;script&gt;` become a tag that the stripper has
 * already walked past. Whatever comes out is text and is only ever rendered as text.
 */
export function toPlainText(html: string | null | undefined): string | null {
  if (html === null || html === undefined) return null;

  const text = decodeEntities(
    html
      .replace(DROPPED_CONTENT, ' ')
      .replace(BREAKS, '\n')
      .replace(TAGS, ' ')
      // A tag that was never closed leaves a trailing "<" the stripper cannot match.
      .replace(/<[^>]*$/, ' '),
  )
    // Tabs and stray carriage returns become spaces; newlines are the only structure kept.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (text === '') return null;
  return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT).trimEnd()}…` : text;
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]{1,31});/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      // Surrogates and out-of-range code points would throw; an undecodable entity stays as it was.
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return match;
      if (code >= 0xd800 && code <= 0xdfff) return match;
      return String.fromCodePoint(code);
    }

    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}
