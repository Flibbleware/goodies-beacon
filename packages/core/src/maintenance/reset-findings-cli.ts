import { loadConfigOrExit } from '../config.js';
import { createDb, createPool } from '../db/client.js';
import { createLogger } from '../logger.js';
import { createBoss } from '../queue/boss.js';
import { clearFindingJobs, otherConnections, resetFindings } from './reset-findings.js';

/**
 * `node packages/core/dist/maintenance/reset-findings-cli.js [--yes]` — see RUNNING.md.
 *
 * Without `--yes` it only reports what it would delete. With it, it refuses while anything else
 * is connected, because a running worker would queue reviews for candidates that are about to go
 * and poll listings back in half way through.
 */

const apply = process.argv.includes('--yes');
const config = loadConfigOrExit();
const pool = createPool(config.databaseUrl);
const db = createDb(pool);

try {
  const others = await otherConnections(db);
  if (others.length > 0) {
    const who = others.join(', ');
    if (apply) {
      console.error(`Refusing to reset: ${who} is still connected. Stop the app first.`);
      process.exit(1);
    }
    console.warn(`Note: ${who} is connected. Stop the app before running with --yes.\n`);
  }

  const summary = await resetFindings(db, { mediaDir: config.mediaDir, apply });

  console.log(apply ? 'Reset complete.\n' : 'Preview only; nothing has changed.\n');
  console.log(
    `AI spend in the ledger: $${summary.spend.thisMonthUsd} this month (UTC), $${summary.spend.allTimeUsd} in all`,
  );
  if (summary.spend.unpricedCalls > 0) {
    console.log(`  plus ${summary.spend.unpricedCalls} calls to a model with no known price`);
  }
  const rows: [string, number | string][] = [
    ['candidates (with their verdicts, notifications, feedback)', summary.candidates],
    ['listings', summary.listings],
    ['seen listings', summary.seen],
    ['listing images', summary.listingImages],
    ['cost ledger rows', summary.costRows],
    ['budget events', summary.budgetEvents],
    ['search plans started from now, stats cleared', summary.plans],
  ];
  if (apply) rows.push(['image files removed', summary.filesRemoved]);
  console.log('');
  for (const [label, value] of rows) console.log(`${label.padEnd(60)}${value}`);

  if (apply) {
    const boss = createBoss(config, createLogger(config.logLevel), {
      schedule: false,
      supervise: false,
    });
    await boss.start();
    try {
      const queues = await clearFindingJobs(boss);
      console.log(`${'job queues cleared'.padEnd(60)}${queues.join(', ') || 'none'}`);
    } finally {
      await boss.stop({ graceful: false });
    }
  } else {
    console.log('\nRun again with --yes to apply.');
  }
} finally {
  await pool.end();
}
