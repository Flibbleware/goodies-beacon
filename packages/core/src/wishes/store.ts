import { desc, eq } from 'drizzle-orm';
import { assertCategory } from '../categories/store.js';
import type { Database } from '../db/client.js';
import { wishItems } from '../db/schema.js';
import { joinTags } from '../domain/tags.js';
import { itemSaveSchema } from '../items/schema.js';
import { insertItem, type SavedVersion } from '../items/store.js';
import type { Wish, WishSaveInput } from './schema.js';

/**
 * Reading and writing the wish list (P1-19). A plain table with no history: a wish has no spec to
 * version, and nothing is ever judged against it.
 */

const columns = {
  id: wishItems.id,
  label: wishItems.label,
  categoryId: wishItems.categoryId,
  searchUrl: wishItems.searchUrl,
  tags: wishItems.tags,
  createdAt: wishItems.createdAt,
  updatedAt: wishItems.updatedAt,
};

/** Newest first, by when it was added rather than edited, so a row does not jump while edited. */
export async function listWishes(db: Database): Promise<Wish[]> {
  return db.select(columns).from(wishItems).orderBy(desc(wishItems.createdAt), desc(wishItems.id));
}

export async function createWish(db: Database, input: WishSaveInput): Promise<Wish> {
  await assertCategory(db, input.categoryId);
  const [row] = await db.insert(wishItems).values(input).returning(columns);
  if (!row) throw new Error('the wish was not inserted');
  return row;
}

/** Undefined when there is no such wish. */
export async function updateWish(
  db: Database,
  id: string,
  input: WishSaveInput,
): Promise<Wish | undefined> {
  await assertCategory(db, input.categoryId);
  const [row] = await db
    .update(wishItems)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(wishItems.id, id))
    .returning(columns);
  return row;
}

/** False when there was no such wish. */
export async function deleteWish(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .delete(wishItems)
    .where(eq(wishItems.id, id))
    .returning({ id: wishItems.id });
  return rows.length > 0;
}

/**
 * Turns a wish into a draft wanted item, and removes the wish, in one transaction — so a double
 * click or a retry cannot make two items, and the thing is never both a wish and wanted.
 *
 * The draft is the same near-empty spec a new item starts from in the editor, searching eBay,
 * which is where the owner is sent next. The category carries over as the item's own (P1-20); the
 * search link and the tags (P1-21) have nowhere to live on an item yet, so they go into version 1's
 * change note rather than vanishing. Undefined when there is no such wish.
 */
export async function promoteWish(db: Database, id: string): Promise<SavedVersion | undefined> {
  return db.transaction(async (tx) => {
    const [wish] = await tx.delete(wishItems).where(eq(wishItems.id, id)).returning(columns);
    if (!wish) return undefined;

    return insertItem(
      tx,
      itemSaveSchema.parse({
        title: wish.label,
        status: 'draft',
        categoryId: wish.categoryId,
        spec: { settings: { sources: ['ebay'] } },
        changeNote: promotionNote(wish),
      }),
    );
  });
}

function promotionNote(wish: Wish): string {
  const parts = ['Promoted from the wish list'];
  if (wish.tags.length > 0) parts.push(`tagged ${joinTags(wish.tags)}`);
  if (wish.searchUrl) parts.push(`searched by hand at ${wish.searchUrl}`);
  return `${parts.join('; ')}.`;
}
