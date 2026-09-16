import { describe, expect, it } from 'vitest';
import { DESCRIPTION_LIMIT, toPlainText } from './text.js';

describe('toPlainText', () => {
  it('leaves a description that is already text alone', () => {
    expect(toPlainText('Boxed, complete, light shelf wear.')).toBe(
      'Boxed, complete, light shelf wear.',
    );
  });

  it('passes null and empty through as null', () => {
    expect(toPlainText(null)).toBeNull();
    expect(toPlainText(undefined)).toBeNull();
    expect(toPlainText('   ')).toBeNull();
    expect(toPlainText('<div>  </div>')).toBeNull();
  });

  it('keeps the line structure a reader needs', () => {
    const html = '<p>Big box copy.</p><ul><li>Manual</li><li>Disc</li></ul>';

    expect(toPlainText(html)).toBe('Big box copy.\nManual\nDisc');
  });

  it('collapses the whitespace an HTML description is padded with', () => {
    const html = '<div>\n\n  Boxed,   complete\t\t\n\n\n\n  <br>  and  clean  </div>';

    expect(toPlainText(html)).toBe('Boxed, complete\n\nand clean');
  });

  /**
   * The whole point of doing this at ingest. A `<script>` whose tags were stripped but whose
   * body was kept would put its source into the description, the prompt and the page.
   */
  it('drops the contents of script and style, not only their tags', () => {
    const html = '<style>.a{color:red}</style><p>Boxed</p><script>alert(document.cookie)</script>';

    expect(toPlainText(html)).toBe('Boxed');
  });

  it('drops an unclosed tag rather than leaving half of it behind', () => {
    expect(toPlainText('Boxed <img src="x" onerror="alert(1)"')).toBe('Boxed');
  });

  it('decodes the entities a seller’s editor leaves behind', () => {
    expect(toPlainText('Boxed &amp; complete &mdash; &pound;95 &nbsp;or best offer')).toBe(
      'Boxed & complete — £95 or best offer',
    );
    expect(toPlainText('&#163;95 &#x41;')).toBe('£95 A');
  });

  /**
   * Entities are decoded after the tags are stripped and never looked at again. Decoding first
   * would turn `&lt;script&gt;` into a tag the stripper has already walked past.
   */
  it('does not let an encoded tag become a real one', () => {
    const text = toPlainText('&lt;script&gt;alert(1)&lt;/script&gt;') as string;

    // Literal characters, which React renders as characters. Nothing re-reads the output as
    // markup — and the round trip shows what would have happened if anything did.
    expect(text).toBe('<script>alert(1)</script>');
    expect(toPlainText(text)).toBeNull();
  });

  it('leaves an entity it cannot decode exactly as it was', () => {
    expect(toPlainText('50&percnt; off &#xD800; &#0;')).toBe('50&percnt; off &#xD800; &#0;');
  });

  it('bounds a pathological description rather than storing all of it', () => {
    const long = toPlainText(`<p>${'word '.repeat(20_000)}</p>`) as string;

    expect(long.length).toBeLessThanOrEqual(DESCRIPTION_LIMIT + 1);
    expect(long.endsWith('…')).toBe(true);
  });
});
