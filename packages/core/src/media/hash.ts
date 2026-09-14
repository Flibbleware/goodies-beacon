import sharp from 'sharp';

/**
 * A difference hash, for "is this the same photo as that earlier listing" (§7 step 2).
 *
 * ARCHITECTURE.md §15 names `blockhash`. It is not used: the published package is a single
 * release from 2019 with no type definitions, and it needs raw pixels, which means sharp is in
 * the pipeline either way. dHash is twenty lines against sharp, has no supply-chain surface, and
 * is exactly as good at the one question asked of it — relists are the same image file, not a
 * re-photograph, so robustness to heavy transformation buys nothing here.
 *
 * The image is reduced to a 9×8 greyscale grid; each of the 64 bits says whether a pixel is
 * brighter than the one to its right. Comparing brightness *gradients* rather than brightness is
 * what makes it survive a thumbnail, a re-encode or a change in overall exposure.
 */

const WIDTH = 9;
const HEIGHT = 8;

/** 64 bits as 16 hex characters. */
export async function perceptualHash(image: Buffer): Promise<string> {
  const pixels = await sharp(image)
    .greyscale()
    // `fit: 'fill'` on purpose: preserving aspect ratio would make the hash depend on the crop,
    // and two copies of one photo at different aspect ratios should still match.
    .resize(WIDTH, HEIGHT, { fit: 'fill' })
    .raw()
    .toBuffer();

  let bits = '';
  for (let row = 0; row < HEIGHT; row += 1) {
    for (let column = 0; column < WIDTH - 1; column += 1) {
      const left = pixels[row * WIDTH + column] ?? 0;
      const right = pixels[row * WIDTH + column + 1] ?? 0;
      bits += left > right ? '1' : '0';
    }
  }

  let hex = '';
  for (let offset = 0; offset < bits.length; offset += 4) {
    hex += Number.parseInt(bits.slice(offset, offset + 4), 2).toString(16);
  }
  return hex;
}

/** How many bits differ. 0 is identical; under about 10 of 64 is "the same picture". */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new Error('hashes are not the same length');

  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    const difference =
      Number.parseInt(a[index] as string, 16) ^ Number.parseInt(b[index] as string, 16);
    distance +=
      (difference & 1) +
      ((difference >> 1) & 1) +
      ((difference >> 2) & 1) +
      ((difference >> 3) & 1);
  }
  return distance;
}

/**
 * The threshold relist detection uses, measured rather than guessed: a real photograph resized
 * to 40% and re-encoded at quality 55 moves 6 bits of 64, while two different photographs sat 46
 * apart. Ten leaves room either side of that.
 *
 * A smooth gradient is the pathological case — adjacent pixels barely differ, so resampling flips
 * bits almost at random, and a synthetic gradient measured 18 after the same treatment. Listing
 * photos are not gradients, but it is worth knowing the failure is "misses a relist" rather than
 * "invents one", and §7 only flags relists rather than rejecting them, so the cost either way is
 * a note on a candidate.
 */
export const SAME_IMAGE_DISTANCE = 10;

export function looksLikeSameImage(a: string, b: string): boolean {
  return hammingDistance(a, b) <= SAME_IMAGE_DISTANCE;
}
