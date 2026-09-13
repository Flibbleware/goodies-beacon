import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, createPool, type Database } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { media } from '../db/schema.js';
import { hammingDistance, looksLikeSameImage, perceptualHash } from './hash.js';
import { MediaRejectedError, storeImage, THUMBNAIL_EDGE } from './ingest.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

let pool: Pool | undefined;
let db: Database;
let mediaDir = '';

/**
 * A picture with irregular structure — a few blocks of different sizes at different places, which
 * is roughly what a photograph of an object reduces to at 9x8.
 *
 * Two earlier versions of this helper were pathological inputs for a difference hash and made a
 * working hash look broken: a smooth gradient (adjacent pixels barely differ, so resampling flips
 * bits almost at random) and a regular checkerboard (which aliases when downsampled from two
 * different source sizes). With this one the same image measures 5-7 bits apart after a resize and
 * re-encode, and two different ones 18-29.
 */
async function picture(seed: number, width = 600, height = 400): Promise<Buffer> {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 40 + seed * 7, g: 60, b: 90 } },
  });
  const shapes = [0, 1, 2, 3, 4].map((n) => {
    // Proportional to the canvas, so the helper also works for the small-image case.
    const shapeWidth = Math.max(4, Math.round(width * (0.1 + ((seed * 31 + n * 97) % 27) / 100)));
    const shapeHeight = Math.max(
      4,
      Math.round(height * (0.12 + ((seed * 17 + n * 53) % 24) / 100)),
    );
    return {
      input: {
        create: {
          width: shapeWidth,
          height: shapeHeight,
          channels: 3 as const,
          background: {
            r: (seed * 40 + n * 60) % 256,
            g: (n * 90 + 30) % 256,
            b: (seed * 25 + n * 45) % 256,
          },
        },
      },
      top: (seed * 23 + n * 71) % (height - shapeHeight),
      left: (seed * 37 + n * 113) % (width - shapeWidth),
    };
  });
  return base.composite(shapes).jpeg().toBuffer();
}

afterAll(async () => {
  await pool?.end();
  if (mediaDir) await rm(mediaDir, { recursive: true, force: true });
});

describe.skipIf(!databaseUrl)('storing an image', () => {
  beforeAll(async () => {
    await runMigrations(databaseUrl as string);
    pool = createPool(databaseUrl as string);
    db = createDb(pool);
    mediaDir = await mkdtemp(join(tmpdir(), 'gb-media-'));
  });

  beforeEach(async () => {
    await db.delete(media);
  });

  it('re-encodes to webp, writes the file and records a row', async () => {
    const row = await storeImage({ db, mediaDir, kind: 'listing', body: await picture(1) });

    expect(row.contentType).toBe('image/webp');
    expect(row.bytes).toBeGreaterThan(0);
    expect(row.perceptualHash).toMatch(/^[0-9a-f]{16}$/);

    const written = await readFile(join(mediaDir, row.path));
    expect((await sharp(written).metadata()).format).toBe('webp');
  });

  it('writes a thumbnail alongside it', async () => {
    const row = await storeImage({ db, mediaDir, kind: 'listing', body: await picture(2) });

    const thumb = await sharp(
      await readFile(join(mediaDir, row.thumbnailPath as string)),
    ).metadata();
    expect(Math.max(thumb.width ?? 0, thumb.height ?? 0)).toBeLessThanOrEqual(THUMBNAIL_EDGE);
  });

  it('resizes a listing photo to 1024 and a reference image to 800', async () => {
    const body = await picture(3, 2000, 1500);

    const listing = await storeImage({ db, mediaDir, kind: 'listing', body });
    await db.delete(media);
    const reference = await storeImage({ db, mediaDir, kind: 'reference', body });

    expect(listing.width).toBe(1024);
    expect(reference.width).toBe(800);
  });

  it('does not enlarge an image that is already smaller than the target', async () => {
    const row = await storeImage({
      db,
      mediaDir,
      kind: 'listing',
      body: await picture(4, 200, 150),
    });

    expect(row.width).toBe(200);
  });

  /** The done-when: the same bytes twice produce one stored file and one row. */
  it('stores the same image once, however many times it arrives', async () => {
    const body = await picture(5);

    const first = await storeImage({ db, mediaDir, kind: 'listing', body });
    const second = await storeImage({ db, mediaDir, kind: 'listing', body });

    expect(second.id).toBe(first.id);
    expect(second.path).toBe(first.path);
    expect(await db.select().from(media)).toHaveLength(1);
  });

  it('settles on one row when two workers ingest the same photo at once', async () => {
    const body = await picture(6);

    const rows = await Promise.all(
      Array.from({ length: 4 }, () => storeImage({ db, mediaDir, kind: 'listing', body })),
    );

    expect(new Set(rows.map((row) => row.id)).size).toBe(1);
    expect(await db.select().from(media)).toHaveLength(1);
  });

  it('keeps two different images apart', async () => {
    const a = await storeImage({ db, mediaDir, kind: 'listing', body: await picture(7) });
    const b = await storeImage({ db, mediaDir, kind: 'listing', body: await picture(8) });

    expect(b.id).not.toBe(a.id);
    expect(await db.select().from(media)).toHaveLength(2);
  });

  it('refuses a corrupt image instead of writing a file', async () => {
    const notAnImage = Buffer.from('GIF89a this is not really an image at all');

    await expect(
      storeImage({ db, mediaDir, kind: 'listing', body: notAnImage }),
    ).rejects.toMatchObject({ reason: 'corrupt' });
    expect(await db.select().from(media)).toHaveLength(0);
  });

  it('refuses a truncated JPEG', async () => {
    const truncated = (await picture(9)).subarray(0, 120);

    await expect(
      storeImage({ db, mediaDir, kind: 'listing', body: truncated }),
    ).rejects.toBeInstanceOf(MediaRejectedError);
  });

  it('keeps the label and source URL a reference image was added with', async () => {
    const row = await storeImage({
      db,
      mediaDir,
      kind: 'reference',
      body: await picture(10),
      label: 'DMG-01 yellow, UK box variant',
      sourceUrl: 'https://example.com/ref.jpg',
    });

    expect(row.label).toBe('DMG-01 yellow, UK box variant');
    expect(row.sourceUrl).toBe('https://example.com/ref.jpg');
  });
});

describe('the perceptual hash', () => {
  it('is stable for the same image', async () => {
    const body = await picture(11);
    expect(await perceptualHash(body)).toBe(await perceptualHash(body));
  });

  /** The point of a perceptual hash: a relist is the same photo, re-encoded or resized. */
  it('survives a resize and a re-encode', async () => {
    const original = await picture(12);
    const resized = await sharp(original).resize(300).webp({ quality: 60 }).toBuffer();

    expect(looksLikeSameImage(await perceptualHash(original), await perceptualHash(resized))).toBe(
      true,
    );
  });

  it('tells two different photographs apart', async () => {
    const a = await perceptualHash(await picture(13));
    const b = await perceptualHash(await picture(20));

    expect(looksLikeSameImage(a, b)).toBe(false);
  });

  it('measures distance between hashes', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
  });

  it('refuses to compare hashes of different lengths rather than guessing', () => {
    expect(() => hammingDistance('abc', 'abcd')).toThrow(/same length/);
  });
});
