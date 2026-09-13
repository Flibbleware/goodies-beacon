import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import sharp, { type Metadata, type Sharp } from 'sharp';
import type { Database } from '../db/client.js';
import { type Media, media } from '../db/schema.js';
import type { MediaKind } from '../domain/constants.js';
import { perceptualHash } from './hash.js';
import {
  assertFetchableUrl,
  assertPublicAddress,
  BlockedAddressError,
  type Resolver,
} from './ssrf.js';

/**
 * Fetching, re-encoding and storing an image (P1-05).
 *
 * Every image is re-encoded rather than stored as it arrived. That normalises the format for the
 * reviewer, strips EXIF — which can carry a seller's GPS coordinates, and §4 says no marketplace
 * user data is persisted — and means a file that is not really an image never reaches the disk,
 * because sharp refuses it before anything is written.
 */

/** Longest edge, by use. Reference images are smaller because every review pays for them (§9). */
export const STORED_EDGE: Record<MediaKind, number> = {
  listing: 1024,
  reference: 800,
  grade_example: 600,
};

export const THUMBNAIL_EDGE = 320;
/** Generous for a listing photo and far below anything that would trouble the droplet's memory. */
export const MAX_BYTES = 15 * 1024 * 1024;
export const MAX_REDIRECTS = 2;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

export class MediaRejectedError extends Error {
  override readonly name = 'MediaRejectedError';
  constructor(
    message: string,
    readonly reason: 'blocked' | 'too_large' | 'not_an_image' | 'corrupt',
  ) {
    super(message);
  }
}

export interface FetchImageOptions {
  fetchImpl?: typeof fetch;
  resolve?: Resolver;
  maxBytes?: number;
  signal?: AbortSignal;
}

/**
 * Fetches an image with the SSRF guard applied at every hop.
 *
 * Redirects are followed by hand rather than by the fetch implementation, because a guard that
 * only checks the first URL is no guard at all: the whole trick is to serve a 302 to
 * `http://169.254.169.254/` from a public address.
 */
export async function fetchImage(
  rawUrl: string,
  options: FetchImageOptions = {},
): Promise<{ body: Buffer; contentType: string; url: string }> {
  const doFetch = options.fetchImpl ?? fetch;
  const resolve: Resolver =
    options.resolve ??
    (async (hostname) => {
      const answers = await lookup(hostname, { all: true });
      return answers.map((answer) => answer.address);
    });
  const maxBytes = options.maxBytes ?? MAX_BYTES;

  let target = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = assertFetchableUrl(target);
    await assertPublicAddress(url, resolve);

    const response = await doFetch(url.toString(), {
      redirect: 'manual',
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new MediaRejectedError('redirect without a location', 'not_an_image');
      target = new URL(location, url).toString();
      continue;
    }

    if (!response.ok) {
      throw new MediaRejectedError(`image fetch failed: HTTP ${response.status}`, 'not_an_image');
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!ALLOWED_TYPES.has(contentType)) {
      throw new MediaRejectedError(
        `not an image: content-type ${contentType || 'missing'}`,
        'not_an_image',
      );
    }

    // Checked before reading, so an honest server saves us the download entirely.
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new MediaRejectedError(
        `image is ${declared} bytes, over the ${maxBytes} cap`,
        'too_large',
      );
    }

    const body = Buffer.from(await response.arrayBuffer());
    // And again after, because content-length is a claim, not a fact.
    if (body.byteLength > maxBytes) {
      throw new MediaRejectedError(
        `image is ${body.byteLength} bytes, over the ${maxBytes} cap`,
        'too_large',
      );
    }

    return { body, contentType, url: url.toString() };
  }

  throw new MediaRejectedError(`more than ${MAX_REDIRECTS} redirects`, 'blocked');
}

export interface StoreImageOptions {
  db: Database;
  mediaDir: string;
  kind: MediaKind;
  body: Buffer;
  sourceUrl?: string | undefined;
  label?: string | undefined;
}

/** Where a stored file lives, sharded by the first two hex characters so no directory grows huge. */
export function mediaPath(contentHash: string, suffix: string): string {
  return join(contentHash.slice(0, 2), `${contentHash}${suffix}.webp`);
}

/**
 * Re-encodes, hashes and stores one image, returning the existing row if the same bytes are
 * already held. The content hash is of the *original* bytes, so the same photo fetched twice is
 * recognised before any work is done on it.
 */
export async function storeImage(options: StoreImageOptions): Promise<Media> {
  const { db, mediaDir, kind, body } = options;

  const contentHash = createHash('sha256').update(body).digest('hex');
  const [existing] = await db
    .select()
    .from(media)
    .where(eq(media.contentHash, contentHash))
    .limit(1);
  if (existing) return existing;

  let image: Sharp;
  let metadata: Metadata;
  try {
    image = sharp(body, { failOn: 'error' });
    metadata = await image.metadata();
  } catch (cause) {
    throw new MediaRejectedError(
      `could not read the image: ${cause instanceof Error ? cause.message : String(cause)}`,
      'corrupt',
    );
  }

  if (!metadata.width || !metadata.height) {
    throw new MediaRejectedError('image has no dimensions', 'corrupt');
  }

  const edge = STORED_EDGE[kind];
  let stored: Buffer;
  let thumbnail: Buffer;
  try {
    // `withoutEnlargement` so a small photo is not blown up into a blurry larger file.
    stored = await sharp(body)
      .rotate()
      .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    thumbnail = await sharp(body)
      .rotate()
      .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 74 })
      .toBuffer();
  } catch (cause) {
    throw new MediaRejectedError(
      `could not re-encode the image: ${cause instanceof Error ? cause.message : String(cause)}`,
      'corrupt',
    );
  }

  const hash = await perceptualHash(body).catch(() => null);
  const storedPath = mediaPath(contentHash, '');
  const thumbnailPath = mediaPath(contentHash, '-thumb');

  for (const [relative, bytes] of [
    [storedPath, stored],
    [thumbnailPath, thumbnail],
  ] as const) {
    const absolute = join(mediaDir, relative);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
  }

  const resized = await sharp(stored).metadata();

  // Two workers can ingest the same photo at once; the unique index on content_hash decides, and
  // the loser reads back what the winner wrote rather than failing the poll.
  const [inserted] = await db
    .insert(media)
    .values({
      kind,
      path: storedPath,
      thumbnailPath,
      contentHash,
      perceptualHash: hash,
      contentType: 'image/webp',
      bytes: stored.byteLength,
      width: resized.width ?? null,
      height: resized.height ?? null,
      label: options.label ?? null,
      sourceUrl: options.sourceUrl ?? null,
    })
    .onConflictDoNothing({ target: media.contentHash })
    .returning();

  if (inserted) return inserted;

  const [raced] = await db.select().from(media).where(eq(media.contentHash, contentHash)).limit(1);
  if (!raced) throw new Error('media row vanished between insert and read');
  return raced;
}

export { BlockedAddressError };

/** One media row by id, so callers outside core need no query builder of their own. */
export async function findMedia(db: Database, id: string): Promise<Media | undefined> {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return row;
}
