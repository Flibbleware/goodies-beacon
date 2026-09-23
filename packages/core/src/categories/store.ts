import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { categories, wantedItems, wishItems } from '../db/schema.js';
import type { Category, CategorySaveInput } from './schema.js';

/** Reading and writing the owner's categories (P1-22). */

export class DuplicateCategoryError extends Error {
  override readonly name = 'DuplicateCategoryError';
  constructor(readonly categoryName: string) {
    super(`There is already a category called ${categoryName}.`);
  }
}

export class UnknownCategoryError extends Error {
  override readonly name = 'UnknownCategoryError';
  constructor(readonly categoryId: string) {
    super(`No category with id ${categoryId}.`);
  }
}

// Drizzle writes a column inside `sql` without its table, and a bare "id" in these subqueries
// would be the wish's or the item's own, so both sides are qualified by hand.
const columns = {
  id: categories.id,
  name: categories.name,
  icon: categories.icon,
  colour: categories.colour,
  wishes: sql<number>`(select count(*)::int from ${wishItems} where ${wishItems}.category_id = ${categories}.id)`,
  items: sql<number>`(select count(*)::int from ${wantedItems} where ${wantedItems}.category_id = ${categories}.id)`,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
};

/** A–Z, ignoring case. */
export async function listCategories(db: Database): Promise<Category[]> {
  return db
    .select(columns)
    .from(categories)
    .orderBy(asc(sql`lower(${categories.name})`), asc(categories.id));
}

export async function createCategory(db: Database, input: CategorySaveInput): Promise<Category> {
  await assertNameFree(db, input.name);
  const [row] = await db.insert(categories).values(input).returning({ id: categories.id });
  if (!row) throw new Error('the category was not inserted');
  return readCategory(db, row.id) as Promise<Category>;
}

/** Undefined when there is no such category. */
export async function updateCategory(
  db: Database,
  id: string,
  input: CategorySaveInput,
): Promise<Category | undefined> {
  await assertNameFree(db, input.name, id);
  const [row] = await db
    .update(categories)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  return row ? readCategory(db, row.id) : undefined;
}

/**
 * False when there was no such category. Whatever used it is left uncategorised, by the foreign
 * keys' `on delete set null`, rather than refused: Settings names the count before asking.
 */
export async function deleteCategory(db: Database, id: string): Promise<boolean> {
  const rows = await db
    .delete(categories)
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  return rows.length > 0;
}

/**
 * An id naming no category is a foreign key violation, which reaches the API as a 500 about a
 * constraint nobody typed. Checked first so the form can point at the field instead.
 */
export async function assertCategory(
  db: Pick<Database, 'select'>,
  id: string | null,
): Promise<void> {
  if (id === null) return;
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  if (!row) throw new UnknownCategoryError(id);
}

async function readCategory(db: Database, id: string): Promise<Category | undefined> {
  const [row] = await db.select(columns).from(categories).where(eq(categories.id, id));
  return row;
}

// The unique index on lower(name) is the guarantee; this is so a clash is a 409 with the name in
// it rather than a 500 about the index.
async function assertNameFree(db: Database, name: string, except?: string): Promise<void> {
  const clash = sql`lower(${categories.name}) = lower(${name})`;
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(except ? and(clash, ne(categories.id, except)) : clash)
    .limit(1);
  if (row) throw new DuplicateCategoryError(name);
}
