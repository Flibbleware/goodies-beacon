import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { fetchImage, MAX_BYTES, MediaRejectedError } from './ingest.js';
import { BlockedAddressError } from './ssrf.js';

const PUBLIC = async () => ['93.184.216.34'];

async function jpeg(width = 40, height = 30): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .jpeg()
    .toBuffer();
}

function serving(body: Buffer | string, init: ResponseInit = {}): typeof fetch {
  return (async () =>
    new Response(body as unknown as ReadableStream, {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
      ...init,
    })) as unknown as typeof fetch;
}

describe('fetchImage', () => {
  it('fetches an image and reports its type', async () => {
    const body = await jpeg();
    const result = await fetchImage('https://example.com/a.jpg', {
      fetchImpl: serving(body),
      resolve: PUBLIC,
    });

    expect(result.contentType).toBe('image/jpeg');
    expect(result.body.byteLength).toBe(body.byteLength);
  });

  it('refuses a private address before making any request', async () => {
    let called = false;
    const impl = (async () => {
      called = true;
      return new Response('');
    }) as unknown as typeof fetch;

    await expect(
      fetchImage('http://169.254.169.254/latest/meta-data/', { fetchImpl: impl, resolve: PUBLIC }),
    ).rejects.toBeInstanceOf(BlockedAddressError);
    expect(called).toBe(false);
  });

  /**
   * The redirect is the whole trick: a public host answering 302 to the metadata service. A guard
   * that only checked the first URL would wave this straight through.
   */
  it('applies the guard to every redirect hop, not just the first', async () => {
    const impl = (async (url: string) => {
      if (url.includes('start')) {
        return new Response('', {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        });
      }
      return new Response(await jpeg(), { headers: { 'content-type': 'image/jpeg' } });
    }) as unknown as typeof fetch;

    await expect(
      fetchImage('https://example.com/start', { fetchImpl: impl, resolve: PUBLIC }),
    ).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('follows a redirect to a public address', async () => {
    let hop = 0;
    const impl = (async () => {
      hop += 1;
      if (hop === 1) {
        return new Response('', {
          status: 301,
          headers: { location: 'https://cdn.example.com/a.jpg' },
        });
      }
      return new Response(await jpeg(), { headers: { 'content-type': 'image/jpeg' } });
    }) as unknown as typeof fetch;

    await expect(
      fetchImage('https://example.com/a.jpg', { fetchImpl: impl, resolve: PUBLIC }),
    ).resolves.toMatchObject({ contentType: 'image/jpeg' });
  });

  it('gives up after two redirects rather than following a loop forever', async () => {
    const impl = (async () =>
      new Response('', {
        status: 302,
        headers: { location: 'https://example.com/round-again' },
      })) as unknown as typeof fetch;

    await expect(
      fetchImage('https://example.com/a.jpg', { fetchImpl: impl, resolve: PUBLIC }),
    ).rejects.toThrow(/more than 2 redirects/);
  });

  it('refuses a response that is not an image', async () => {
    const impl = serving('<html>not a photo</html>', {
      headers: { 'content-type': 'text/html' },
    });

    await expect(
      fetchImage('https://example.com/a.jpg', { fetchImpl: impl, resolve: PUBLIC }),
    ).rejects.toMatchObject({ reason: 'not_an_image' });
  });

  it('refuses a response with no content type at all', async () => {
    const impl = (async () => new Response('bytes')) as unknown as typeof fetch;

    await expect(
      fetchImage('https://example.com/a.jpg', { fetchImpl: impl, resolve: PUBLIC }),
    ).rejects.toThrow(/content-type/);
  });

  /**
   * The early check is a bandwidth saving — an honest server's `content-length` spares us the
   * download. It is not the safety guarantee: that is the check after reading, below, which is
   * what holds when a server lies. Whether the body was read is not observable from here, since
   * a ReadableStream is pulled on construction, so this asserts the refusal and leaves the
   * ordering to the test that follows.
   */
  it('refuses on a declared size over the cap', async () => {
    const impl = serving(Buffer.alloc(8), {
      headers: { 'content-type': 'image/jpeg', 'content-length': String(MAX_BYTES + 1) },
    });

    await expect(
      fetchImage('https://example.com/a.jpg', { fetchImpl: impl, resolve: PUBLIC }),
    ).rejects.toMatchObject({ reason: 'too_large' });
  });

  /** content-length is a claim; a server that lies must still not fill the disk. */
  it('refuses on the real size when content-length understated it', async () => {
    const impl = serving(Buffer.alloc(2048), {
      headers: { 'content-type': 'image/jpeg', 'content-length': '10' },
    });

    await expect(
      fetchImage('https://example.com/a.jpg', {
        fetchImpl: impl,
        resolve: PUBLIC,
        maxBytes: 1024,
      }),
    ).rejects.toMatchObject({ reason: 'too_large' });
  });

  it('reports an HTTP failure rather than storing the error page', async () => {
    const impl = serving('gone', { status: 404, headers: { 'content-type': 'text/html' } });

    await expect(
      fetchImage('https://example.com/a.jpg', { fetchImpl: impl, resolve: PUBLIC }),
    ).rejects.toBeInstanceOf(MediaRejectedError);
  });
});
