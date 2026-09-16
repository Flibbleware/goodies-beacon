import {
  authSession,
  authUser,
  createDb,
  createPool,
  listings,
  media,
  runMigrations,
  seen,
  settings,
  wantedItems,
} from '@goodies-beacon/core';

/**
 * A fresh instance for every run: the smoke test starts at first run and sets the password, which
 * only works if no user exists, and it saves settings and creates wanted items it then asserts on.
 * Migrations run here too, so the API under test does not have to — failing here gives a clearer
 * message than a dead web server would.
 */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'E2E_DATABASE_URL (or TEST_DATABASE_URL) must point at a throwaway Postgres database.',
    );
  }

  await runMigrations(databaseUrl);

  const pool = createPool(databaseUrl);
  try {
    const db = createDb(pool);
    await db.delete(authSession);
    await db.delete(authUser);
    await db.delete(settings);
    // The spec editor steps create items and upload a photo, and the audit-view steps seed
    // listings and candidates; all of them start from nothing. Listings outlive an item by
    // design — §4 keys them on (source, externalId) globally — so they are cleared explicitly.
    await db.delete(wantedItems);
    await db.delete(listings);
    await db.delete(seen);
    await db.delete(media);
  } finally {
    await pool.end();
  }
}
