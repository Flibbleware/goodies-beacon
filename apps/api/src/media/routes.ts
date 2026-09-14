import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import {
  type Database,
  findMedia,
  type Logger,
  type Media,
  MediaRejectedError,
  storeImage,
} from '@goodies-beacon/core';
import { type Context, Hono } from 'hono';
import { errorResponse } from '../errors.js';

export interface MediaRouteDeps {
  readonly db: Database;
  readonly mediaDir: string;
  readonly logger: Logger;
}

/** Re-encoded on ingest and addressed by a hash of its bytes, so a stored file never changes. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/** 15 MB matches the ingest cap; a larger upload is refused before it is read into memory. */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function createMediaRoutes({ db, mediaDir, logger }: MediaRouteDeps) {
  const routes = new Hono();

  /**
   * Reference image upload (§8). The file is re-encoded by `storeImage`, which is what makes an
   * upload safe to accept: whatever arrives, what reaches the disk is a webp sharp produced.
   */
  routes.post('/', async (c) => {
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) {
      return errorResponse(c, 400, 'no_file', 'Attach an image as the `file` field.');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return errorResponse(c, 413, 'too_large', `Images must be under ${MAX_UPLOAD_BYTES} bytes.`);
    }

    const label = typeof form.label === 'string' ? form.label : undefined;

    try {
      const row = await storeImage({
        db,
        mediaDir,
        kind: 'reference',
        body: Buffer.from(await file.arrayBuffer()),
        label,
      });
      return c.json({ media: publicView(row) }, 201);
    } catch (error) {
      if (error instanceof MediaRejectedError) {
        return errorResponse(c, 400, error.reason, error.message);
      }
      throw error;
    }
  });

  routes.get('/:id', async (c) => serveFile(c, db, mediaDir, logger, false));
  routes.get('/:id/thumb', async (c) => serveFile(c, db, mediaDir, logger, true));

  return routes;
}

function publicView(row: Media) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
  };
}

async function serveFile(
  c: Context,
  db: Database,
  mediaDir: string,
  logger: Logger,
  thumbnail: boolean,
): Promise<Response> {
  const id = c.req.param('id');
  const row = id ? await findMedia(db, id) : undefined;
  if (!row) return errorResponse(c, 404, 'not_found', 'No such image.');

  const relative = thumbnail ? row.thumbnailPath : row.path;
  if (!relative) return errorResponse(c, 404, 'not_found', 'No such image.');

  /**
   * The path comes from our own row rather than from the request, but it is still joined and
   * checked: a row is data, and a traversal in one would otherwise read anything the process can.
   */
  const absolute = normalize(join(mediaDir, relative));
  if (!absolute.startsWith(normalize(mediaDir))) {
    logger.warn('media path escaped the media directory', { id, relative });
    return errorResponse(c, 404, 'not_found', 'No such image.');
  }

  try {
    const info = await stat(absolute);
    const etag = `"${row.contentHash}${thumbnail ? '-t' : ''}"`;
    if (c.req.header('if-none-match') === etag) return new Response(null, { status: 304 });

    return new Response(Readable.toWeb(createReadStream(absolute)) as ReadableStream, {
      headers: {
        'content-type': row.contentType,
        'content-length': String(info.size),
        'cache-control': IMMUTABLE,
        etag,
      },
    });
  } catch {
    // The row outliving its file means retention removed one and not the other.
    logger.warn('media row has no file on disk', { id, relative });
    return errorResponse(c, 404, 'not_found', 'No such image.');
  }
}
