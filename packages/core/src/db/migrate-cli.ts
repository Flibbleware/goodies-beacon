import { loadConfigOrExit } from '../config.js';
import { runMigrations } from './migrate.js';

const config = loadConfigOrExit();
await runMigrations(config.databaseUrl);
console.log('migrations applied');
